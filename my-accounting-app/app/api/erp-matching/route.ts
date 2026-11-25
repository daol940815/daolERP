import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { refundGuard } from '@/lib/payment-cancel-meta'
import { getCurrentUser } from '@/lib/user-role'
import { findAutoMatches, loadMatchingState } from '@/lib/erp-matching'
import { FROM_INVOICE_BLOCK, syncInvoicesForOrders } from '@/lib/link-sync'
import { syncRecordsForOrders } from '@/lib/payment-records'
import { insertMatches, logUnmatch, loadRecentUnmatches } from '@/lib/match-log'
import { resolveReason } from '@/lib/payment-reasons'
import { addBankKeyword, learnableKeyword, loadBankKeywords } from '@/lib/vendor-keywords.server'

const editorOf = async () => { const me = await getCurrentUser(); return { employeeId: me?.employeeId ?? null, employeeName: me?.employeeName ?? null } }

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

  // 추천 (2026-11-16): 예전 "자동 매칭 실행"이 사람 확인 없이 확정하던 조건(같은 거래처 · 잔액 같음 · 날짜 가까움 · 양쪽 후보 하나뿐)을
  // 이제는 추천으로만 붙인다. 확정은 화면에서 사람이 누른다(시스템은 추천만 — 절대 원칙).
  const days = Math.min(Math.max(Number(searchParams.get('days')) || 7, 1), 120)
  const recommend = new Map(findAutoMatches(state, days).map(p => [p.deposit.id, p.order]))

  // 통장 키워드(2026-11-25) — 입금을 붙일 때 입금자 표기를 그 매출처 통장 키워드로 기록할지(화면 체크 칸, 기본 체크)
  const open = state.deposits.filter(d => d.remaining > 0)
  const kw = await loadBankKeywords(admin, open.filter(d => d.source_type === 'bank').map(d => d.vendor_id))
  // 미배분 입금별 후보 주문 (같은 거래처, 잔액 있는 주문 — 날짜 가까운 순)
  const pending = open
    .map(d => ({
      ...d,
      learn: d.source_type === 'bank' ? learnableKeyword((d.counterparty_name || d.description || '').trim(), d.vendor_name, kw.get(d.vendor_id) ?? []) : null,
      recommend: recommend.has(d.id) ? { id: recommend.get(d.id)!.id, order_no: recommend.get(d.id)!.order_no, order_date: recommend.get(d.id)!.order_date, remaining: recommend.get(d.id)!.remaining, customer_name: recommend.get(d.id)!.customer_name, manager: recommend.get(d.id)!.manager ?? '' } : null,
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

  // 최근 해제 이력 (1307) — 사유 · 사람 · 시각
  return NextResponse.json({ pending, matched, released: await loadRecentUnmatches(admin) })
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
    learn_keyword?: string | null   // 통장: 입금자 표기를 매출처 통장 키워드로 기록 (2026-11-25)
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
  const { error: ie } = await insertMatches(admin, rows, '입금대장')
  if (ie) return NextResponse.json({ error: ie.message }, { status: 500 })
  // 결제 기록(1300)과 동기화 — 기록의 주문 · 금액이 이 매칭으로 채워지면 자동 확정 (2026-11-16)
  const sync = await syncRecordsForOrders(admin, rows.map(r => r.order_id), await editorOf(), '입금 매칭')
  // 주문이 계산서에 연결돼 있으면 이 통장 입금을 계산서 입금으로도 넘긴다 (1302 2단계)
  if (body.source_type === 'bank') await syncInvoicesForOrders(admin, rows.map(r => r.order_id))

  const learned = body.source_type === 'bank' && typeof body.learn_keyword === 'string' && source.vendor_id
    ? (await addBankKeyword(admin, source.vendor_id, body.learn_keyword).catch(() => ({ keyword: null }))).keyword : null
  return NextResponse.json({ ok: true, inserted: rows.length, records_confirmed: sync.confirmed, records_released: sync.released, keyword: learned })
}

// DELETE /api/erp-matching?id=  { reason: { code, text } } — 매칭 해제. 사유 필수(1307, 2026-11-18) — 해제 이력에 사유 · 사람 · 시각이 남는다
export async function DELETE(req: NextRequest) {
  const admin = createAdminClient()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })

  // 선결제 사용 매칭(514)은 원장 차감 행과 한 쌍 — 함께 지워야 선결제 잔액이 복원된다 (주문 트랙 2026-11-05)
  const body = await req.json().catch(() => ({})) as { reason?: unknown }
  const reason = resolveReason('release', body.reason)
  if ('error' in reason) return NextResponse.json({ error: reason.error }, { status: 400 })
  const { data: m } = await admin.from('erp_payment_matches').select('id, source_type, source_id, order_id, record_id, amount, paid_date').eq('id', id).maybeSingle()
  // 계산서 입금에서 넘어온 수금(1302)은 계산서 쪽에서만 푼다 — 여기서 지우면 계산서는 입금 완료인데 주문만 미수로 어긋난다
  const { data: fm } = await admin.from('erp_payment_matches').select('from_invoice_id').eq('id', id).maybeSingle()
  if (fm?.from_invoice_id) return NextResponse.json({ error: FROM_INVOICE_BLOCK }, { status: 409 })
  // 환불(마이너스) 매칭 · 취소가 확정된 기록의 수금은 여기서 풀지 않는다 (1306)
  const guard = await refundGuard(admin, id)
  if (guard) return NextResponse.json({ error: guard }, { status: 409 })
  const { error } = await admin.from('erp_payment_matches').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (m) await logUnmatch(admin, [m], '매칭 해제', reason)
  if (m?.source_type === 'prepay') {
    await admin.from('erp_prepayments').delete().eq('id', m.source_id as string).eq('entry_type', 'deduction')
  }
  // 결제 기록(1300)에 연결된 매칭을 지우면 기록은 자동으로 확인 대기로 돌아간다(이력에 사유). 2026-11-16 — 매칭을 풀면 확정도 풀린다
  const sync = m?.order_id ? await syncRecordsForOrders(admin, [m.order_id as string], await editorOf(), '입금 매칭 해제') : { confirmed: 0, released: 0 }
  // 계산서로 넘어갔던 입금도 함께 푼다 (1302 2단계)
  if (m?.order_id && m.source_type === 'bank') await syncInvoicesForOrders(admin, [m.order_id as string])

  return NextResponse.json({ ok: true, records_released: sync.released })
}
