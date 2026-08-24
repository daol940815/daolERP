import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildCashPositionRows } from '@/lib/cash-reports'
import { buildCreditLineInterest } from '@/lib/loan-interest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MIGRATION_MSG = '마이그레이션 402(loans)가 아직 실행되지 않았습니다. SQL 편집기에서 402_loans_master.sql을 실행해 주세요.'

// GET /api/loans — 대출 목록 + 계좌 선택용 bank_accounts + 한도대출 사용액(통장 원본)
export async function GET() {
  const admin = createAdminClient()

  const { data: loans, error } = await admin
    .from('loans')
    .select('*, bank_accounts(bank_name, account_number)')
    .order('seq', { ascending: true })
  if (error) {
    if (/loans/.test(error.message)) {
      return NextResponse.json({ loans: [], bankAccounts: [], overdrafts: [], migration402: false, migration404: false })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 404 미적용 환경에서도 동작하도록 컬럼 존재 여부로 판정
  const migration404 = (loans ?? []).length === 0 || 'product_type' in (loans![0] as object)

  // 한도대출 사용액은 저장하지 않고 통장 잔액에서 산출한다 (마이그레이션 404 주석 참조).
  // 자금현황과 같은 계산을 재사용해 두 화면의 숫자가 어긋나지 않게 한다.
  const [bankRes, cash] = await Promise.all([
    admin.from('bank_accounts').select('id, bank_name, account_number').order('bank_name'),
    buildCashPositionRows(admin, null, null),
  ])
  if (bankRes.error) return NextResponse.json({ error: bankRes.error.message }, { status: 500 })

  const overdrafts = 'rows' in cash
    ? cash.rows
        .filter(r => r.account_type === 'overdraft')
        .map(r => ({
          bank_account_id: r.bank_account_id,
          overdraft_limit: r.overdraft_limit,
          overdraft_used: r.overdraft_used,
          overdraft_available: r.overdraft_available,
          balance_date: r.balance_date,
        }))
    : []

  // 한도대출 당월 이자 — 통장 일별 잔액 기준(경과일 실적) + 잔여일 추정
  const creditLoans = (loans ?? [])
    .filter(l => (l.product_type ?? 'term') === 'credit_line')
    .map(l => ({ id: l.id as string, bank_account_id: l.bank_account_id as string | null,
                 interest_rate: l.interest_rate as number | null }))
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  const pad = (n: number) => String(n).padStart(2, '0')
  const monthFirst = `${y}-${pad(m + 1)}-01`
  const todayStr = `${y}-${pad(m + 1)}-${pad(now.getDate())}`
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const remainingDays = daysInMonth - now.getDate()

  let creditInterest: {
    loan_id: string; mtd_interest: number; projected_interest: number
    last_used: number; days_elapsed: number; days_in_month: number
  }[] = []
  if (creditLoans.length) {
    const ci = await buildCreditLineInterest(admin, creditLoans, monthFirst, todayStr)
    if (!('error' in ci)) {
      const rateById = new Map(creditLoans.map(l => [l.id, l.interest_rate]))
      creditInterest = ci.rows.map(r => {
        const rate = rateById.get(r.loan_id) ?? null
        const projected = rate == null
          ? r.total
          : r.total + Math.round(r.last_used * (rate / 100) / 365 * remainingDays)
        return {
          loan_id: r.loan_id,
          mtd_interest: r.total,
          projected_interest: projected,
          last_used: r.last_used,
          days_elapsed: now.getDate(),
          days_in_month: daysInMonth,
        }
      })
    }
  }

  return NextResponse.json({
    loans: loans ?? [],
    bankAccounts: bankRes.data ?? [],
    overdrafts,
    creditInterest,
    migration402: true,
    migration404,
  })
}

// 편집 허용 필드 (원본 엑셀 대체 마스터 — 사용자 직접 관리)
const EDITABLE = [
  'title', 'bank_name', 'bank_account_id', 'original_amount', 'current_balance',
  'balance_date', 'interest_rate', 'rate_note', 'monthly_principal', 'monthly_interest',
  'payment_day', 'start_date', 'maturity_date', 'term_type', 'status', 'memo',
  'product_type', 'credit_limit',
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
