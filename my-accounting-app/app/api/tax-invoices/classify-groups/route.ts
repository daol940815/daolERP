import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/tax-invoices/classify-groups?direction=purchase
// 미분류 세금계산서를 거래처 단위로 묶고, 그룹마다 추천 계정을 계산해 내려준다.
// 추천 우선순위 (거래처 마스터 정책 §7 — 자동은 추천만, 확정은 사용자):
//   ① 같은 거래처의 확정 이력 과반 계정
//   ② 거래처 기본계정(vendors.default_account_id)
//   ③ 품목명 키워드(accounts.keywords)
type InvoiceRow = {
  id: string
  vendor_id: string | null
  counterparty_name: string | null
  counterparty_biz_number: string | null
  item_name: string | null
  issue_date: string
  supply_amount: number | null
  total_amount: number | null
  confirmed_account_id: string | null
}

export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const direction = new URL(req.url).searchParams.get('direction') ?? 'purchase'

  const invResult = await fetchAllRows<InvoiceRow>((f, t) =>
    admin
      .from('tax_invoices')
      .select('id, vendor_id, counterparty_name, counterparty_biz_number, item_name, issue_date, supply_amount, total_amount, confirmed_account_id')
      .eq('direction', direction)
      .range(f, t),
  )
  if ('error' in invResult) return NextResponse.json({ error: invResult.error }, { status: 500 })
  const invoices = invResult.data

  const { data: accounts } = await admin
    .from('accounts')
    .select('id, code, name, keywords')
    .eq('is_active', true)
  const accName = new Map((accounts ?? []).map(a => [a.id as string, { code: a.code as string, name: a.name as string }]))
  const kwAccounts = (accounts ?? [])
    .filter(a => Array.isArray(a.keywords) && (a.keywords as string[]).length)
    .map(a => ({ id: a.id as string, keywords: a.keywords as string[] }))

  // 거래처 기본계정
  const vendorIds = Array.from(new Set(invoices.map(i => i.vendor_id).filter((v): v is string => !!v)))
  const defaultAcc = new Map<string, string>()
  for (let i = 0; i < vendorIds.length; i += 100) {
    const { data } = await admin
      .from('vendors')
      .select('id, default_account_id')
      .in('id', vendorIds.slice(i, i + 100))
      .not('default_account_id', 'is', null)
    for (const v of data ?? []) defaultAcc.set(v.id as string, v.default_account_id as string)
  }

  // ① 확정 이력 (거래처 키 → 계정별 확정 건수)
  const groupKey = (i: InvoiceRow) => i.vendor_id ?? `name:${(i.counterparty_name ?? '').trim()}`
  const history = new Map<string, Map<string, number>>()
  for (const i of invoices) {
    if (!i.confirmed_account_id) continue
    const key = groupKey(i)
    const c = history.get(key) ?? new Map<string, number>()
    c.set(i.confirmed_account_id, (c.get(i.confirmed_account_id) ?? 0) + 1)
    history.set(key, c)
  }
  const majority = (key: string): { id: string; hits: number } | null => {
    const c = history.get(key)
    if (!c) return null
    let best: [string, number] | null = null
    let total = 0
    c.forEach((n, acc) => { total += n; if (!best || n > best[1]) best = [acc, n] })
    const b = best as [string, number] | null
    return b && b[1] * 2 > total ? { id: b[0], hits: b[1] } : null
  }
  const keywordHit = (text: string | null): { id: string; keyword: string } | null => {
    const t = text ?? ''
    let best: { id: string; keyword: string } | null = null
    for (const a of kwAccounts) {
      for (const k of a.keywords) {
        if (k && t.includes(k) && (!best || k.length > best.keyword.length)) best = { id: a.id, keyword: k }
      }
    }
    return best
  }

  // 미분류 건을 거래처 그룹으로 집계
  type Group = {
    key: string
    vendor_id: string | null
    counterparty_name: string
    count: number
    supply_total: number
    invoice_ids: string[]
    date_from: string
    date_to: string
    suggestion: { account_id: string; code: string; name: string; reason: string } | null
  }
  const groups = new Map<string, Group>()
  for (const i of invoices) {
    if (i.confirmed_account_id) continue
    const key = groupKey(i)
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        vendor_id: i.vendor_id,
        counterparty_name: (i.counterparty_name ?? '(상호 없음)').trim() || '(상호 없음)',
        count: 0, supply_total: 0, invoice_ids: [],
        date_from: i.issue_date, date_to: i.issue_date,
        suggestion: null,
      }
      groups.set(key, g)
    }
    g.count++
    g.supply_total += i.supply_amount ?? 0
    g.invoice_ids.push(i.id)
    if (i.issue_date < g.date_from) g.date_from = i.issue_date
    if (i.issue_date > g.date_to) g.date_to = i.issue_date
  }

  // 그룹별 추천 계산
  for (const g of Array.from(groups.values())) {
    const h = majority(g.key)
    if (h) {
      const a = accName.get(h.id)
      if (a) { g.suggestion = { account_id: h.id, ...a, reason: `확정 이력 ${h.hits}건` }; continue }
    }
    const d = g.vendor_id ? defaultAcc.get(g.vendor_id) : undefined
    if (d) {
      const a = accName.get(d)
      if (a) { g.suggestion = { account_id: d, ...a, reason: '거래처 기본계정' }; continue }
    }
    // 그룹 첫 건의 품목명으로 키워드 추천 (그룹 내 품목이 대체로 동일하다는 가정의 약한 추천)
    const sample = invoices.find(i => !i.confirmed_account_id && groupKey(i) === g.key)
    const k = keywordHit(sample?.item_name ?? null)
    if (k) {
      const a = accName.get(k.id)
      if (a) g.suggestion = { account_id: k.id, ...a, reason: `키워드 "${k.keyword}"` }
    }
  }

  const list = Array.from(groups.values()).sort((a, b) => b.count - a.count)
  const classified = invoices.filter(i => i.confirmed_account_id).length
  return NextResponse.json({
    data: list,
    summary: {
      total: invoices.length,
      classified,
      unclassified: invoices.length - classified,
      groups: list.length,
      suggested_groups: list.filter(g => g.suggestion).length,
    },
  })
}
