import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 취소발행 상계 도구 — 같은 거래처의 원 계산서(+A)와 취소 계산서(-A)가
// 둘 다 미확인으로 남은 쌍을 찾아, 승인 시 거래 연결 없이 '확인됨'으로 상계 처리한다.
// (전액 취소는 주고받은 돈이 없으므로 매칭할 거래 자체가 없다 — 수동 배지 처리의 일괄판)

const PAIR_WINDOW_DAYS = 90

interface InvRow {
  id: string
  issue_date: string
  vendor_id: string | null
  counterparty_name: string | null
  counterparty_biz_number: string | null
  total_amount: number | null
  tax_type: string
  item_name: string | null
  payment_status: string
  payment_memo: string | null
}

const dayDiff = (a: string, b: string) =>
  Math.abs(new Date(a.slice(0, 10)).getTime() - new Date(b.slice(0, 10)).getTime()) / 86_400_000

const groupKey = (r: InvRow) =>
  r.vendor_id ?? (r.counterparty_biz_number ? `biz:${r.counterparty_biz_number}` : `name:${(r.counterparty_name ?? '').trim()}`)

async function loadUnmatched(direction: string) {
  const admin = createAdminClient()
  return fetchAllRows<InvRow>((f, t) =>
    admin.from('tax_invoices')
      .select('id, issue_date, vendor_id, counterparty_name, counterparty_biz_number, total_amount, tax_type, item_name, payment_status, payment_memo')
      .eq('direction', direction)
      .eq('payment_status', 'unmatched')
      .range(f, t))
}

function findPairs(rows: InvRow[]) {
  const byGroup = new Map<string, InvRow[]>()
  for (const r of rows) {
    const k = groupKey(r)
    byGroup.set(k, [...(byGroup.get(k) ?? []), r])
  }
  const pairs: { pos: InvRow; neg: InvRow; gap_days: number }[] = []
  for (const group of Array.from(byGroup.values())) {
    const usedPos = new Set<string>()
    const negs = group.filter(r => (r.total_amount ?? 0) < 0)
      .sort((a, b) => a.issue_date.localeCompare(b.issue_date))
    for (const neg of negs) {
      const cands = group.filter(p =>
        !usedPos.has(p.id) &&
        (p.total_amount ?? 0) === -(neg.total_amount ?? 0) &&
        (p.total_amount ?? 0) > 0 &&
        dayDiff(p.issue_date, neg.issue_date) <= PAIR_WINDOW_DAYS)
      if (!cands.length) continue
      const pos = cands.sort((a, b) => dayDiff(a.issue_date, neg.issue_date) - dayDiff(b.issue_date, neg.issue_date))[0]
      usedPos.add(pos.id)
      pairs.push({ pos, neg, gap_days: Math.round(dayDiff(pos.issue_date, neg.issue_date)) })
    }
  }
  pairs.sort((a, b) => b.pos.issue_date.localeCompare(a.pos.issue_date))
  return pairs
}

// GET /api/tax-invoices/cancel-pairs?direction=sales|purchase
export async function GET(req: NextRequest) {
  const direction = new URL(req.url).searchParams.get('direction')
  if (direction !== 'sales' && direction !== 'purchase') {
    return NextResponse.json({ error: 'direction이 필요합니다.' }, { status: 400 })
  }
  const result = await loadUnmatched(direction)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  const pairs = findPairs(result.data).map(p => ({
    pos_id: p.pos.id,
    neg_id: p.neg.id,
    counterparty: p.pos.counterparty_name ?? p.neg.counterparty_name ?? '(상대 미상)',
    pos_date: p.pos.issue_date,
    neg_date: p.neg.issue_date,
    amount: p.pos.total_amount ?? 0,
    tax_type: p.pos.tax_type,
    item_name: p.pos.item_name,
    gap_days: p.gap_days,
  }))
  return NextResponse.json({ pairs, count: pairs.length })
}

// POST — body: { direction, pairs: [{ posId, negId }] }
// 서버에서 쌍을 재검증(둘 다 미확인·합계 0)한 뒤 확인 처리한다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => null) as { direction?: string; pairs?: { posId: string; negId: string }[] } | null
  const wanted = (body?.pairs ?? []).filter(p => p.posId && p.negId)
  if (body?.direction !== 'sales' && body?.direction !== 'purchase') {
    return NextResponse.json({ error: 'direction이 필요합니다.' }, { status: 400 })
  }
  if (!wanted.length) return NextResponse.json({ error: '확인할 쌍이 없습니다.' }, { status: 400 })

  // 현재 서버 상태 기준으로 유효한 쌍만 통과 (다른 화면에서 이미 처리된 건 건너뜀)
  const result = await loadUnmatched(body.direction)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  const byId = new Map(result.data.map(r => [r.id, r]))

  let confirmed = 0
  let skipped = 0
  for (const w of wanted) {
    const pos = byId.get(w.posId)
    const neg = byId.get(w.negId)
    const valid = pos && neg &&
      (pos.total_amount ?? 0) > 0 &&
      ((pos.total_amount ?? 0) + (neg.total_amount ?? 0)) === 0 &&
      groupKey(pos) === groupKey(neg)
    if (!valid) { skipped++; continue }

    const ids = [pos.id, neg.id]
    const { error } = await admin.from('tax_invoices')
      .update({ payment_status: 'matched' })
      .in('id', ids)
    if (error) return NextResponse.json({ error: error.message, confirmed, skipped }, { status: 500 })
    // 메모는 비어 있을 때만 채운다 (기존 메모 보존)
    for (const r of [pos, neg]) {
      if (!r.payment_memo) {
        await admin.from('tax_invoices').update({ payment_memo: '취소발행 상계 확인' }).eq('id', r.id)
      }
    }
    confirmed++
  }
  return NextResponse.json({ confirmed, skipped })
}
