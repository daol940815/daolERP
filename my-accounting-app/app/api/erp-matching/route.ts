import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { loadMatchingState } from '@/lib/erp-matching'

export const dynamic = 'force-dynamic'

const MIGRATION_MSG = '매칭 테이블이 없습니다. Supabase SQL Editor에서 마이그레이션 021_erp_payment_matches.sql을 실행해주세요.'

// GET /api/erp-matching?from=&to=
// 검토대기(미배분 입금 + 후보 주문)와 매칭완료 목록 반환
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const state = await loadMatchingState(admin, searchParams.get('from'), searchParams.get('to'))
  if ('error' in state) {
    return NextResponse.json(
      { error: state.missingTable ? MIGRATION_MSG : state.error },
      { status: state.missingTable ? 428 : 500 })
  }

  const ordersByVendor = new Map<string, typeof state.orders>()
  for (const o of state.orders) {
    if (o.remaining <= 0) continue
    const list = ordersByVendor.get(o.vendor_id) ?? []
    list.push(o)
    ordersByVendor.set(o.vendor_id, list)
  }

  // 미배분 입금별 후보 주문 (같은 거래처, 잔액 있는 주문 — 날짜 가까운 순)
  const pending = state.deposits
    .filter(d => d.remaining > 0)
    .map(d => ({
      ...d,
      candidates: (ordersByVendor.get(d.vendor_id) ?? [])
        .slice()
        .sort((a, b) =>
          Math.abs(new Date(d.tx_date).getTime() - new Date(a.order_date).getTime())
          - Math.abs(new Date(d.tx_date).getTime() - new Date(b.order_date).getTime()))
        .slice(0, 30),
    }))

  // 매칭완료 목록 (주문 정보 병합)
  const orderById = new Map(state.orders.map(o => [o.id, o]))
  const txById = new Map(state.deposits.map(d => [d.id, d]))
  const from = searchParams.get('from')
  const to   = searchParams.get('to')
  const matched = state.matches
    .filter(m => (!from || m.paid_date >= from) && (!to || m.paid_date <= to))
    .map(m => {
      const o = orderById.get(m.order_id)
      const t = m.source_type === 'bank' ? txById.get(m.source_id) : undefined
      return {
        ...m,
        order_no: o?.order_no ?? '(기간 외 주문)',
        customer_name: o?.customer_name ?? '',
        order_date: o?.order_date ?? null,
        counterparty_name: t?.counterparty_name ?? null,
      }
    })
    .sort((a, b) => b.paid_date.localeCompare(a.paid_date))

  return NextResponse.json({ pending, matched })
}

// POST /api/erp-matching — 수동 배분
// body: { source_type: 'bank' | 'card', source_id, allocations: [{ order_id, amount }], memo? }
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as {
    source_type?: string
    source_id?: string
    allocations?: { order_id: string; amount: number }[]
    memo?: string
  }

  if ((body.source_type !== 'bank' && body.source_type !== 'card') || !body.source_id) {
    return NextResponse.json({ error: 'source_type(bank/card)과 source_id가 필요합니다.' }, { status: 400 })
  }
  const allocations = (body.allocations ?? []).filter(a => a.order_id && Number(a.amount) > 0)
  if (!allocations.length) {
    return NextResponse.json({ error: '배분할 주문과 금액을 입력하세요.' }, { status: 400 })
  }

  const state = await loadMatchingState(admin, null, null)
  if ('error' in state) {
    return NextResponse.json(
      { error: state.missingTable ? MIGRATION_MSG : state.error },
      { status: state.missingTable ? 428 : 500 })
  }

  const source = state.deposits.find(d => d.source_type === body.source_type && d.id === body.source_id)
  if (!source) return NextResponse.json({ error: '입금/결제 내역을 찾을 수 없습니다.' }, { status: 404 })

  const totalAlloc = allocations.reduce((s, a) => s + Math.round(Number(a.amount)), 0)
  if (totalAlloc > source.remaining) {
    return NextResponse.json(
      { error: `배분 합계(${totalAlloc.toLocaleString()}원)가 잔액(${source.remaining.toLocaleString()}원)을 초과합니다.` },
      { status: 400 })
  }

  const rows = allocations.map(a => ({
    order_id: a.order_id,
    source_type: body.source_type,
    source_id: body.source_id,
    amount: Math.round(Number(a.amount)),
    paid_date: source.tx_date,
    matched_by: 'manual',
    memo: body.memo?.trim() || null,
  }))
  const { error: ie } = await admin.from('erp_payment_matches').insert(rows)
  if (ie) return NextResponse.json({ error: ie.message }, { status: 500 })

  return NextResponse.json({ ok: true, inserted: rows.length })
}

// DELETE /api/erp-matching?id= — 매칭 해제
export async function DELETE(req: NextRequest) {
  const admin = createAdminClient()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })

  const { error } = await admin.from('erp_payment_matches').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
