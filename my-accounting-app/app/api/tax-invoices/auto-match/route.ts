import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { addInvoicePayment } from '@/lib/tax-invoice-payments.server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST /api/tax-invoices/auto-match — body: { direction?, taxType?, invoiceIds? }
// 미확인(unmatched) 세금계산서 중, 금액이 일치하고 사업자번호 또는 거래처명이
// 적요에 포함되는 거래내역이 단 하나로 좁혀지는 건만 자동으로 연결 처리한다.
// invoiceIds가 있으면 그 선택 건들만 대상으로 한다(선택 자동매칭).
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
  const allTxResult = await fetchAllRows<{ id: string; description: string | null; counterparty_name: string | null; vendor_id: string | null; amount_in: number | null; amount_out: number | null }>((rFrom, rTo) =>
    admin
      .from('transactions')
      .select('id, description, counterparty_name, vendor_id, amount_in, amount_out')
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

  let matched = 0
  const usedTx = new Set<string>()   // 이번 실행에서 이미 연결한 거래는 재사용 금지
  for (const inv of invoices) {
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

    const candidates = txs.filter(tx => {
      const desc           = (tx.description as string) ?? ''
      const counterparty   = (tx.counterparty_name as string | null) ?? ''
      const haystack       = `${desc} ${counterparty}`
      const haystackDigits = haystack.replace(/[^0-9]/g, '')
      return (inv.vendor_id && tx.vendor_id === inv.vendor_id)
        || (bizDigits && haystackDigits.includes(bizDigits))
        || (name && haystack.includes(name))
        || aliases.some(alias => alias && haystack.includes(alias))
    })

    if (candidates.length === 1) {
      const result = await addInvoicePayment(admin, inv.id as string, candidates[0].id as string, inv.total_amount as number)
      if (result.ok) { matched++; usedTx.add(candidates[0].id) }
    }
  }

  return NextResponse.json({ matched, checked: invoices?.length ?? 0 })
}
