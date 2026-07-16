import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { addInvoicePayment } from '@/lib/tax-invoice-payments.server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST /api/tax-invoices/auto-match — body: { direction?, taxType?, invoiceIds? }
// 미확인(unmatched) 세금계산서 중, 금액이 일치하고 사업자번호 또는 거래처명이
// 적요에 포함되는 거래내역을 자동으로 연결 처리한다.
// invoiceIds가 있으면 그 선택 건들만 대상으로 한다(선택 자동매칭).
//
// 날짜 규칙 (다올커머스 업무 특성): 매출은 선입금, 매입은 선지급이 거의 없다 —
// 지급/수금은 계산서 발행 이후에 이뤄진다. 따라서 발행일 이전 거래는 후보에서
// 제외하고(선지급은 예외 → 수동 확인), 발행일 이후 후보가 여럿이면 월 정기거래
// (매달 같은 금액: 렌탈료·보험료 등)를 전제로 발행일에 가장 가까운 거래를 고른다.
// 단 아래 안전장치를 모두 통과할 때만 연결하고, 하나라도 애매하면 수동으로 남긴다.
// 거래내역은 한 번에 프리페치해 메모리에서 매칭한다 — 계산서 건마다 개별 조회하면
// 미매칭 수천 건 × 요청이 되어 라우트가 죽는다(fetch failed).
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { direction?: string; taxType?: string; invoiceIds?: string[] }

  const invoicesResult = await fetchAllRows<{ id: string; direction: string; total_amount: number; issue_date: string; vendor_id: string | null; counterparty_name: string | null; counterparty_biz_number: string | null }>((rFrom, rTo) => {
    let query = admin
      .from('tax_invoices')
      .select('id, direction, total_amount, issue_date, vendor_id, counterparty_name, counterparty_biz_number')
      .eq('payment_status', 'unmatched')
    if (body.direction) query = query.eq('direction', body.direction)
    if (body.taxType)   query = query.eq('tax_type', body.taxType)
    return query.range(rFrom, rTo)
  })
  if ('error' in invoicesResult) return NextResponse.json({ error: invoicesResult.error }, { status: 500 })
  // 선택 건 한정 (URL 길이 문제를 피하려고 메모리에서 필터)
  const onlyIds = body.invoiceIds?.length ? new Set(body.invoiceIds) : null
  const invoices = onlyIds
    ? invoicesResult.data.filter(inv => onlyIds.has(inv.id))
    : invoicesResult.data

  // 결제연결 전체를 1회에 프리페치 — 대상 계산서 id로 .in() 하면 URL 한도에 걸리고
  // 요청 수도 늘어난다. 여기서 두 가지를 얻는다:
  //   ① 이미 부분/분할 결제가 연결된 계산서 → 자동매칭 건너뜀 (수동 처리)
  //   ② 거래별 기연결 금액 → 이전 실행에서 이미 쓴 거래를 다시 연결하지 않음
  const allPaysResult = await fetchAllRows<{ tax_invoice_id: string; transaction_id: string; amount: number }>((rFrom, rTo) =>
    admin
      .from('tax_invoice_payments')
      .select('tax_invoice_id, transaction_id, amount')
      .range(rFrom, rTo),
  )
  if ('error' in allPaysResult) return NextResponse.json({ error: allPaysResult.error }, { status: 500 })
  const partiallyPaidIds = new Set<string>()
  const usedAmountByTx = new Map<string, number>()
  const targetIds = new Set(invoices.map(inv => inv.id))
  for (const p of allPaysResult.data) {
    if (targetIds.has(p.tax_invoice_id)) partiallyPaidIds.add(p.tax_invoice_id)
    usedAmountByTx.set(p.transaction_id, (usedAmountByTx.get(p.transaction_id) ?? 0) + p.amount)
  }

  // 매칭된 거래처들의 학습된 별칭(입금자명 등)을 조회해 N+1 쿼리 방지 (URL 한도 대비 100개 청크)
  const vendorIds = Array.from(new Set((invoices ?? []).map(inv => inv.vendor_id).filter((v): v is string => !!v)))
  const aliasMap = new Map<string, string[]>()
  for (let i = 0; i < vendorIds.length; i += 100) {
    const { data: vendors, error: vErr } = await admin
      .from('vendors')
      .select('id, match_aliases')
      .in('id', vendorIds.slice(i, i + 100))
    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 })
    for (const v of vendors ?? []) {
      aliasMap.set(v.id as string, (v.match_aliases as string[] | null) ?? [])
    }
  }

  // 거래내역 프리페치 (1회) — 금액별 인덱스 구성
  const allTxResult = await fetchAllRows<{ id: string; tx_date: string; description: string | null; counterparty_name: string | null; vendor_id: string | null; amount_in: number | null; amount_out: number | null }>((rFrom, rTo) =>
    admin
      .from('transactions')
      .select('id, tx_date, description, counterparty_name, vendor_id, amount_in, amount_out')
      .is('transfer_pair_id', null)
      .range(rFrom, rTo),
  )
  if ('error' in allTxResult) return NextResponse.json({ error: allTxResult.error }, { status: 500 })
  type TxRow = typeof allTxResult.data[number]
  const txByAmountIn = new Map<number, TxRow[]>()
  const txByAmountOut = new Map<number, TxRow[]>()
  for (const t of allTxResult.data) {
    if ((t.amount_in ?? 0) > 0) {
      const arr = txByAmountIn.get(t.amount_in!) ?? []
      arr.push(t); txByAmountIn.set(t.amount_in!, arr)
    }
    if ((t.amount_out ?? 0) > 0) {
      const arr = txByAmountOut.get(t.amount_out!) ?? []
      arr.push(t); txByAmountOut.set(t.amount_out!, arr)
    }
  }

  // 날짜 판정 기준값
  const MARGIN_DAYS    = 15 // 후보가 여럿일 때 최근접이 2등보다 이만큼 가까워야 유일 판정 (월 정기거래 구분)
  const MAX_LAG_DAYS   = 35 // 후보가 여럿일 때 최근접 거래가 발행 후 이 일수 이내여야 연결
  const PRE_GUARD_DAYS = 7  // 발행일 이전 거래가 (최근접 이후 거래 + 이 값)보다 가까우면 애매 → 수동
  const DAY = 86_400_000

  let matched = 0
  const usedTx = new Set<string>()   // 이번 실행에서 이미 연결한 거래는 재사용 금지
  // 발행일 오름차순으로 처리 — 월 정기거래(매달 같은 금액)에서 각 달의 계산서가
  // 그 달의 지급을 순서대로 가져가야 뒤 계산서가 앞 달 지급을 잘못 집지 않는다.
  const ordered = [...invoices].sort((a, b) => (a.issue_date < b.issue_date ? -1 : a.issue_date > b.issue_date ? 1 : 0))
  for (const inv of ordered) {
    if (partiallyPaidIds.has(inv.id)) continue

    // 이번 실행에서 쓴 거래(usedTx)뿐 아니라 이전 실행/수동 매칭에서
    // 이미 다른 계산서에 연결된 거래(usedAmountByTx)도 제외한다
    const txs = ((inv.direction === 'sales' ? txByAmountIn : txByAmountOut).get(inv.total_amount) ?? [])
      .filter(t => {
        if (usedTx.has(t.id)) return false
        const cap = (inv.direction === 'sales' ? t.amount_in : t.amount_out) ?? 0
        return cap - (usedAmountByTx.get(t.id) ?? 0) >= inv.total_amount
      })
    if (!txs.length) continue

    const bizDigits = inv.counterparty_biz_number?.replace(/[^0-9]/g, '') ?? ''
    const name      = inv.counterparty_name?.trim() ?? ''
    const aliases   = inv.vendor_id ? (aliasMap.get(inv.vendor_id) ?? []) : []

    const identified = txs.filter(tx => {
      const desc           = (tx.description as string) ?? ''
      const counterparty   = (tx.counterparty_name as string | null) ?? ''
      const haystack       = `${desc} ${counterparty}`
      const haystackDigits = haystack.replace(/[^0-9]/g, '')
      return (inv.vendor_id && tx.vendor_id === inv.vendor_id)
        || (bizDigits && haystackDigits.includes(bizDigits))
        || (name && haystack.includes(name))
        || aliases.some(alias => alias && haystack.includes(alias))
    })
    if (!identified.length) continue

    // ── 날짜 규칙 적용 ──
    const issueTime = new Date(inv.issue_date).getTime()
    const lagOf = (tx: TxRow) => Math.round((new Date(tx.tx_date).getTime() - issueTime) / DAY)
    // 발행일 이전 거래는 후보 제외 (선지급/선입금은 예외 케이스 → 수동 확인·승인)
    const dated = identified.filter(tx => lagOf(tx) >= 0).sort((a, b) => lagOf(a) - lagOf(b))
    if (!dated.length) continue

    const nearest    = dated[0]
    const nearestLag = lagOf(nearest)
    // 발행일 이전 거래가 선택 대상과 비슷하게 가깝다면 (월말 발행 + 월중 선지급 패턴 가능성)
    // 어느 쪽인지 자동으로 단정하지 않고 수동에 남긴다
    const preLags = identified.filter(tx => lagOf(tx) < 0).map(tx => -lagOf(tx))
    if (preLags.length && Math.min(...preLags) <= nearestLag + PRE_GUARD_DAYS) continue

    if (dated.length >= 2) {
      // 여러 달 치 정기 지급이 모두 후보인 경우 — 전부 같은 거래처이고,
      // 최근접이 발행 후 35일 이내이며 2등보다 15일 이상 가까울 때만 그 달 건으로 확정
      const vendorSet = new Set(dated.map(tx => tx.vendor_id))
      if (vendorSet.size !== 1 || vendorSet.has(null)) continue
      if (nearestLag > MAX_LAG_DAYS) continue
      if (lagOf(dated[1]) - nearestLag < MARGIN_DAYS) continue
    }

    const result = await addInvoicePayment(admin, inv.id as string, nearest.id as string, inv.total_amount as number)
    if (result.ok) { matched++; usedTx.add(nearest.id) }
  }

  return NextResponse.json({ matched, checked: invoices?.length ?? 0 })
}
