import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// GET /api/transactions/classify-groups
// 통장 거래를 유형으로 갈라낸 뒤, 계정 분류가 필요한 건들을 유사거래 묶음으로 내려준다.
//
// 유형 (분개 이중계상 방지의 핵심 — docs/master-plan-2026-07.md 1-B):
//   transfer     계좌간 이체 (transfer_pair 지정됨)         → 분류 대상 아님
//   internal     자사명 입출금 (이체쌍 후보)                 → 이체 연결 or 판단 필요
//   settlement   카드사 정산입금                             → 정산 확정 흐름에서 처리 (매출채권 상계)
//   card_payment 카드대금 출금                               → 미지급금(2001) 상계로 확정
//   invoice      세금계산서와 매칭된 입출금                  → 채권(1101)/채무(2001) 상계로 확정
//   general      나머지 (수수료·이자·급여 등)                → 계정 확정 대상
//
// 추천은 추천일 뿐 — 확정은 항상 사용자.
const SETTLEMENT_PATTERNS: { canonical: string; re: RegExp }[] = [
  { canonical: '하나카드',   re: /^하나\d/ },
  { canonical: 'BC카드',     re: /^BC[-]?\d/i },
  { canonical: 'KB국민카드', re: /^KB\d/i },
  { canonical: '신한카드',   re: /^신한\d/ },
  { canonical: '현대카드',   re: /^현대\d/ },
  { canonical: '삼성카드',   re: /^삼성\d/ },
  { canonical: 'NH농협카드', re: /^NH\d/i },
  { canonical: '롯데카드',   re: /^롯데\d/ },
]
const OWN_NAME = /다올커머/

type Tx = {
  id: string
  tx_date: string
  description: string | null
  counterparty_name: string | null
  vendor_id: string | null
  amount_in: number | null
  amount_out: number | null
  transfer_pair_id: string | null
  bank_account_id: string | null
  status: string
  confirmed_account_id: string | null
}

export async function GET() {
  const admin = createAdminClient()

  const txResult = await fetchAllRows<Tx>((f, t) =>
    admin
      .from('transactions')
      .select('id, tx_date, description, counterparty_name, vendor_id, amount_in, amount_out, transfer_pair_id, bank_account_id, status, confirmed_account_id')
      .range(f, t),
  )
  if ('error' in txResult) return NextResponse.json({ error: txResult.error }, { status: 500 })
  const txs = txResult.data

  const [{ data: cardVendors }, { data: accounts }] = await Promise.all([
    admin.from('vendors').select('id, name').eq('is_card_company', true),
    admin.from('accounts').select('id, code, name, keywords').eq('is_active', true),
  ])
  const cardVendorById = new Map((cardVendors ?? []).map(v => [v.id as string, v.name as string]))
  const cardVendorByName = new Map((cardVendors ?? []).map(v => [v.name as string, v.id as string]))
  const accByCode = new Map((accounts ?? []).map(a => [a.code as string, { id: a.id as string, name: a.name as string }]))
  const accName = new Map((accounts ?? []).map(a => [a.id as string, { code: a.code as string, name: a.name as string }]))
  const kwAccounts = (accounts ?? [])
    .filter(a => Array.isArray(a.keywords) && (a.keywords as string[]).length)
    .map(a => ({ id: a.id as string, keywords: a.keywords as string[] }))

  const paidResult = await fetchAllRows<{ transaction_id: string }>((f, t) =>
    admin.from('tax_invoice_payments').select('transaction_id').range(f, t),
  )
  const paidTx = new Set('error' in paidResult ? [] : paidResult.data.map(p => p.transaction_id))

  // 거래처 기본계정 (⑤ 추천용)
  const { data: vendorDefaults } = await admin
    .from('vendors').select('id, default_account_id').not('default_account_id', 'is', null)
  const defaultAcc = new Map((vendorDefaults ?? []).map(v => [v.id as string, v.default_account_id as string]))

  const receivable = accByCode.get('1101')
  const payable = accByCode.get('2001')

  const detectCardCompany = (t: Tx): string | null => {
    if (t.vendor_id && cardVendorById.has(t.vendor_id)) return cardVendorById.get(t.vendor_id)!
    const desc = `${t.description ?? ''} ${t.counterparty_name ?? ''}`.trim()
    return SETTLEMENT_PATTERNS.find(p => p.re.test(desc))?.canonical ?? null
  }
  const keywordHit = (text: string): { id: string; keyword: string } | null => {
    let best: { id: string; keyword: string } | null = null
    for (const a of kwAccounts) {
      for (const k of a.keywords) {
        if (k && text.includes(k) && (!best || k.length > best.keyword.length)) best = { id: a.id, keyword: k }
      }
    }
    return best
  }

  type Suggestion = { account_id: string; code: string; name: string; reason: string; vendor_id?: string | null } | null
  type Group = {
    key: string
    kind: 'internal' | 'settlement' | 'card_payment' | 'invoice' | 'general'
    label: string
    count: number
    in_total: number
    out_total: number
    transaction_ids: string[]
    suggestion: Suggestion
    pairable?: number   // internal: 반대편 계좌에서 이체쌍 후보를 찾은 건수
  }
  const groups = new Map<string, Group>()
  const add = (key: string, kind: Group['kind'], label: string, t: Tx, suggestion: Suggestion = null) => {
    let g = groups.get(key)
    if (!g) {
      g = { key, kind, label, count: 0, in_total: 0, out_total: 0, transaction_ids: [], suggestion }
      groups.set(key, g)
    }
    g.count++
    g.in_total += t.amount_in ?? 0
    g.out_total += t.amount_out ?? 0
    g.transaction_ids.push(t.id)
  }

  const types = { transfer: 0, classified: 0, internal: 0, settlement: 0, card_payment: 0, invoice: 0, general: 0 }
  const internals: Tx[] = []

  for (const t of txs) {
    if (t.transfer_pair_id) { types.transfer++; continue }
    if (t.confirmed_account_id && t.status === 'confirmed') { types.classified++; continue }
    const hay = `${t.description ?? ''} ${t.counterparty_name ?? ''}`.trim()

    if (OWN_NAME.test(hay)) {
      types.internal++
      internals.push(t)
      add('internal', 'internal', '자사명 입출금 (이체쌍 후보)', t)
      continue
    }
    const cardCo = detectCardCompany(t)
    if (cardCo && (t.amount_in ?? 0) > 0) {
      types.settlement++
      add(`settle:${cardCo}`, 'settlement', `${cardCo} 정산입금`, t,
        receivable ? { account_id: receivable.id, code: '1101', name: receivable.name, reason: '매출채권 상계 (정산)', vendor_id: cardVendorByName.get(cardCo) ?? null } : null)
      continue
    }
    if (cardCo && (t.amount_out ?? 0) > 0) {
      types.card_payment++
      add(`cardpay:${cardCo}`, 'card_payment', `${cardCo} 카드대금 출금`, t,
        payable ? { account_id: payable.id, code: '2001', name: payable.name, reason: '미지급금 상계 (카드대금)', vendor_id: cardVendorByName.get(cardCo) ?? null } : null)
      continue
    }
    if (paidTx.has(t.id)) {
      types.invoice++
      const inflow = (t.amount_in ?? 0) > 0
      const acc = inflow ? receivable : payable
      add(`invoice:${inflow ? 'in' : 'out'}`, 'invoice', inflow ? '세계 매칭 입금 (수금)' : '세계 매칭 출금 (지급)', t,
        acc ? { account_id: acc.id, code: inflow ? '1101' : '2001', name: acc.name, reason: inflow ? '매출채권 상계' : '미지급금 상계', vendor_id: t.vendor_id } : null)
      continue
    }
    // ⑤ 일반 — 유사거래 묶음 (상대명/적요에서 숫자 제거 후 앞 14자)
    types.general++
    const label = (t.counterparty_name || t.description || '(적요 없음)').trim()
    const norm = label.replace(/\d+/g, '').trim().slice(0, 14) || '(적요 없음)'
    let suggestion: Suggestion = null
    if (t.vendor_id && defaultAcc.has(t.vendor_id)) {
      const a = accName.get(defaultAcc.get(t.vendor_id)!)
      if (a) suggestion = { account_id: defaultAcc.get(t.vendor_id)!, ...a, reason: '거래처 기본계정', vendor_id: t.vendor_id }
    }
    if (!suggestion) {
      const k = keywordHit(hay)
      if (k) {
        const a = accName.get(k.id)
        if (a) suggestion = { account_id: k.id, ...a, reason: `키워드 "${k.keyword}"` }
      }
    }
    add(`gen:${norm}`, 'general', norm, t, suggestion)
  }

  // internal 그룹의 이체쌍 후보 계산 — 같은 금액·반대 방향·±1일·다른 계좌
  const internalGroup = groups.get('internal')
  if (internalGroup && internals.length) {
    const byAmt = new Map<number, Tx[]>()
    for (const t of internals) {
      const amt = (t.amount_in ?? 0) > 0 ? (t.amount_in ?? 0) : -(t.amount_out ?? 0)
      const arr = byAmt.get(Math.abs(amt)) ?? []
      arr.push(t)
      byAmt.set(Math.abs(amt), arr)
    }
    let pairable = 0
    const near = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= 86400_000
    for (const arr of Array.from(byAmt.values())) {
      const ins = arr.filter(t => (t.amount_in ?? 0) > 0)
      const outs = arr.filter(t => (t.amount_out ?? 0) > 0)
      const usedOut = new Set<string>()
      for (const i of ins) {
        const o = outs.find(o => !usedOut.has(o.id) && o.bank_account_id !== i.bank_account_id && near(i.tx_date, o.tx_date))
        if (o) { usedOut.add(o.id); pairable += 2 }
      }
    }
    internalGroup.pairable = pairable
  }

  const list = Array.from(groups.values()).sort((a, b) => {
    const order = { internal: 0, settlement: 1, card_payment: 2, invoice: 3, general: 4 }
    return order[a.kind] - order[b.kind] || b.count - a.count
  })
  return NextResponse.json({ data: list, types, total: txs.length })
}
