import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetch-all-rows'
import { loadReceivableMap } from './orders-portal-list'

// ── 내 대시보드 주문 카드 (2026-11-19 사용자 결정, docs/my-dashboard-track.md) ──
//  - 내 작성 주문     = 주문 입력자가 나. 판정은 주문내역 '내 주문처리 건'(lib/orders-portal-list.ts isMyHandled)과 같다:
//                       created_by_employee_id 우선, 비어 있는 옛 주문만 staff_name 이름 대조
//  - 내 담당 지점 주문 = 주문의 매출처(별칭의 거래처 우선, 없으면 vendor_id)가 내 현재 담당(vendor_staff, ended_at IS NULL).
//                       결제 확인의 '지점 담당' 필터(lib/payment-overview.ts loadOrderStaff)와 같은 기준
//  - 취소 주문(canceled_at)은 건수 · 금액 · 미수 모두에서 뺀다
//  - 미수는 표준 미수(v_erp_order_receivable — 매칭 반영). 뷰를 못 읽으면 주문의 원본 미수로 폴백
// 300 RPC(my_dashboard_summary)의 주문 집계(이름 대조 · 원본 미수)는 이 함수로 대체 — RPC는 담당 거래처 · 영업일지 수에만 쓴다.

const chunk = <T,>(a: T[], n = 150) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

interface OrderRow {
  id: string; order_no: string | null; order_date: string
  bank_name: string | null; branch_name: string | null
  total_amount: number | null; outstanding_amount: number | null
  staff_name: string | null; created_by_employee_id: string | null
  customer_alias_id: string | null; vendor_id: string | null
  created_at: string | null; canceled_at: string | null
}
const COLS = 'id, order_no, order_date, bank_name, branch_name, total_amount, outstanding_amount, staff_name, created_by_employee_id, customer_alias_id, vendor_id, created_at, canceled_at'

export interface OrderStat { cnt: number; total: number; outstanding: number; outstanding_cnt: number }
export interface RecentOrder { id: string; order_no: string | null; order_date: string; customer: string; total_amount: number; outstanding_amount: number }
export interface MyOrderStats {
  written_month: OrderStat          // 이번 달 내 작성 주문
  written_open: OrderStat           // 내 작성 주문 전체 미수 (기간 무관)
  branch_month: OrderStat           // 이번 달 내 담당 지점 주문
  branch_vendor_cnt: number         // 내 담당 지점 수
  recent_written: RecentOrder[]     // 최근 내 작성 주문 5건
}

const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return { from: `${month}-01`, to: `${next}-01` }   // to 는 미포함
}

export async function loadMyOrderStats(
  admin: SupabaseClient,
  me: { employeeId: string | null; employeeName: string | null },
  month: string,
): Promise<MyOrderStats | { error: string }> {
  const empId = me.employeeId
  const empty: OrderStat = { cnt: 0, total: 0, outstanding: 0, outstanding_cnt: 0 }
  if (!empId) return { written_month: empty, written_open: empty, branch_month: empty, branch_vendor_cnt: 0, recent_written: [] }
  const { from, to } = monthRange(month)

  const [monthRes, byIdRes, byNameRes, staffRes] = await Promise.all([
    // 이번 달 주문 전체 (작성 · 담당 지점 판정용)
    fetchAllRows<OrderRow>((f, t) => admin.from('erp_orders').select(COLS).gte('order_date', from).lt('order_date', to).is('canceled_at', null).order('id').range(f, t)),
    // 내 작성 주문 전체 (미수 · 최근 목록용) — 계정 기준
    fetchAllRows<OrderRow>((f, t) => admin.from('erp_orders').select(COLS).eq('created_by_employee_id', empId).is('canceled_at', null).order('id').range(f, t)),
    // 입력자 칸이 빈 옛 주문 — 이름 대조
    me.employeeName
      ? fetchAllRows<OrderRow>((f, t) => admin.from('erp_orders').select(COLS).is('created_by_employee_id', null).eq('staff_name', me.employeeName as string).is('canceled_at', null).order('id').range(f, t))
      : Promise.resolve({ data: [] as OrderRow[] }),
    fetchAllRows<{ vendor_id: string }>((f, t) => admin.from('vendor_staff').select('vendor_id').eq('employee_id', empId).is('ended_at', null).order('vendor_id').range(f, t)),
  ])
  for (const r of [monthRes, byIdRes, byNameRes, staffRes]) if ('error' in r && r.error) return { error: String(r.error) }
  const monthRows = (monthRes as { data: OrderRow[] }).data
  const written = [...(byIdRes as { data: OrderRow[] }).data, ...(byNameRes as { data: OrderRow[] }).data]
  const myVendors = new Set((staffRes as { data: { vendor_id: string }[] }).data.map(r => r.vendor_id))

  const isWritten = (o: OrderRow) => o.created_by_employee_id ? o.created_by_employee_id === empId : !!me.employeeName && o.staff_name === me.employeeName

  // 주문 → 매출처: 별칭의 거래처 우선, 없으면 주문의 vendor_id
  const aliasIds = Array.from(new Set(monthRows.map(o => o.customer_alias_id).filter((x): x is string => !!x)))
  const aliasVendor = new Map<string, string>()
  const aliasRes = await Promise.all(chunk(aliasIds).map(ch => admin.from('erp_vendor_aliases').select('id, vendor_id').in('id', ch)))
  for (const r of aliasRes) for (const a of r.data ?? []) if (a.vendor_id) aliasVendor.set(a.id as string, a.vendor_id as string)
  const vendorOf = (o: OrderRow) => (o.customer_alias_id ? aliasVendor.get(o.customer_alias_id) : null) ?? o.vendor_id ?? null
  const branchRows = monthRows.filter(o => { const v = vendorOf(o); return !!v && myVendors.has(v) })

  // 표준 미수 (매칭 반영)
  const ids = Array.from(new Set([...written, ...branchRows].map(o => o.id)))
  const recv = await loadReceivableMap(admin, ids)
  const outOf = (o: OrderRow) => recv?.get(o.id)?.outstanding ?? Number(o.outstanding_amount ?? 0)

  const stat = (rows: OrderRow[]): OrderStat => {
    let total = 0, outstanding = 0, outstanding_cnt = 0
    for (const o of rows) {
      total += Number(o.total_amount ?? 0)
      const out = outOf(o)
      if (out > 0) { outstanding += out; outstanding_cnt++ }
    }
    return { cnt: rows.length, total, outstanding, outstanding_cnt }
  }

  const recent = [...written]
    .sort((a, b) => b.order_date.localeCompare(a.order_date) || (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, 5)
    .map(o => ({
      id: o.id, order_no: o.order_no, order_date: o.order_date,
      customer: [o.bank_name, o.branch_name].filter(Boolean).join(' ') || '(주문처 미상)',
      total_amount: Number(o.total_amount ?? 0), outstanding_amount: outOf(o),
    }))

  return {
    written_month: stat(monthRows.filter(isWritten)),
    written_open: stat(written),
    branch_month: stat(branchRows),
    branch_vendor_cnt: myVendors.size,
    recent_written: recent,
  }
}
