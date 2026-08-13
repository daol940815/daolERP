import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MIGRATION_MSG = '마이그레이션 402(loans)가 아직 실행되지 않았습니다. SQL 편집기에서 402_loans_master.sql을 실행해 주세요.'

// GET /api/loans — 대출 목록 + 계좌 선택용 bank_accounts
export async function GET() {
  const admin = createAdminClient()

  const { data: loans, error } = await admin
    .from('loans')
    .select('*, bank_accounts(bank_name, account_number)')
    .order('seq', { ascending: true })
  if (error) {
    if (/loans/.test(error.message)) {
      return NextResponse.json({ loans: [], bankAccounts: [], migration402: false })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: bankAccounts, error: be } = await admin
    .from('bank_accounts')
    .select('id, bank_name, account_number')
    .order('bank_name')
  if (be) return NextResponse.json({ error: be.message }, { status: 500 })

  return NextResponse.json({ loans: loans ?? [], bankAccounts: bankAccounts ?? [], migration402: true })
}

// 편집 허용 필드 (원본 엑셀 대체 마스터 — 사용자 직접 관리)
const EDITABLE = [
  'title', 'bank_name', 'bank_account_id', 'original_amount', 'current_balance',
  'balance_date', 'interest_rate', 'rate_note', 'monthly_principal', 'monthly_interest',
  'payment_day', 'start_date', 'maturity_date', 'term_type', 'status', 'memo',
] as const

function pickEditable(body: Record<string, unknown>) {
  const row: Record<string, unknown> = {}
  for (const k of EDITABLE) if (k in body) row[k] = body[k] === '' ? null : body[k]
  return row
}

// POST /api/loans — 대출 신규 등록
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body?.title || !body?.bank_name) {
    return NextResponse.json({ error: '대출명과 은행명이 필요합니다.' }, { status: 400 })
  }
  const row = pickEditable(body)

  const { data: maxRow } = await admin
    .from('loans').select('seq').order('seq', { ascending: false }).limit(1).maybeSingle()
  row.seq = ((maxRow?.seq as number) ?? 0) + 1

  const { data, error } = await admin.from('loans').insert(row).select('id').single()
  if (error) {
    if (/loans/.test(error.message)) return NextResponse.json({ error: MIGRATION_MSG }, { status: 400 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: data.id })
}
