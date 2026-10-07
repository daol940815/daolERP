import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import type { AccountPreview } from '@/types/upload'

export const dynamic = 'force-dynamic'

// POST /api/upload/accounts
// 통합계좌 파일 업로드 전 확인용 — 파일에 들어 있는 계좌번호들을 받아
// bank_accounts 등록 여부와 "이미 들어온 마지막 거래일"을 돌려준다.
// 화면은 이 값으로 계좌별 업로드 범위(기존 마지막 거래일 이후만)를 기본 제안한다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body: { digits?: string[] } = await req.json().catch(() => ({}))
  const digits = Array.from(new Set((body.digits ?? []).filter(Boolean)))
  if (!digits.length) return NextResponse.json({ accounts: [] })

  // 계좌번호 표기가 DB마다 다르므로(하이픈 유무) 전량 읽어 숫자만 비교한다.
  // bank_accounts는 수십 건 규모라 전량 조회가 안전하고 빠르다.
  const { data: accts, error } = await admin
    .from('bank_accounts')
    .select('id, bank_name, account_number, account_type')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const byDigits = new Map<string, { id: string; bank_name: string; account_number: string | null; account_type: string | null }>()
  for (const a of accts ?? []) {
    const d = String(a.account_number ?? '').replace(/[^0-9]/g, '')
    if (d && !byDigits.has(d)) byDigits.set(d, a)
  }

  const matchedIds = digits.map(d => byDigits.get(d)?.id).filter(Boolean) as string[]

  // 계좌별 마지막 거래일·건수 — 계좌 수가 적으므로 계좌별 1회 조회(병렬)
  const stats = new Map<string, { last: string | null; count: number }>()
  await Promise.all(matchedIds.map(async id => {
    const [lastRes, cntRes] = await Promise.all([
      admin.from('transactions').select('tx_date')
        .eq('bank_account_id', id).order('tx_date', { ascending: false }).limit(1).maybeSingle(),
      admin.from('transactions').select('id', { count: 'exact', head: true })
        .eq('bank_account_id', id),
    ])
    stats.set(id, { last: lastRes.data?.tx_date ?? null, count: cntRes.count ?? 0 })
  }))

  const accounts: AccountPreview[] = digits.map(d => {
    const db = byDigits.get(d)
    const st = db ? stats.get(db.id) : undefined
    return {
      digits: d,
      bank_account_id: db?.id ?? null,
      db_bank_name: db?.bank_name ?? null,
      db_account_number: db?.account_number ?? null,
      db_account_type: db?.account_type ?? null,
      last_tx_date: st?.last ?? null,
      tx_count: st?.count ?? 0,
    }
  })

  return NextResponse.json({ accounts })
}
