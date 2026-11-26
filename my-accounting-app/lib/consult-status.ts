import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPoStatusMap } from './orders-portal-list'

// ── 상담 상태 · 주문일 (2026-11-26 사용자 승인 — 시안 docs/mockups/상담_요청흐름_시안.html) ──
//  - 주문일 = 그 상담으로 만든 주문서의 주문일(취소 주문 제외). 2건 이상이면 가장 이른 날 + "외 N"
//  - 종결(자동) = DB 상태 '주문전환'이고 연결 주문(취소 제외)의 품목이 모두 발주서에 들어감 — 주문 목록 '발주완료'와 같은 기준
//    (loadPoStatusMap 'full'). 저장하지 않고 볼 때마다 계산 → 발주할 품목이 다시 생기면 '주문전환'으로 돌아간다.
//  - 종결(수동) = DB 상태 '종결'(709 — 주문 없이 끝난 상담, 사유)
//  - 상태 갱신일: 주문전환 = 첫 주문 입력(전환) 날짜, 종결 · 발주 완료 = 마지막 발주서 작성일, 종결(수동) = 종결한 날, 진행중 = 없음

export type ConsultStatusKind = 'open' | 'converted' | 'po_done' | 'closed'
export interface ConsultStatusInfo {
  status: '진행중' | '주문전환' | '종결'      // 화면에 보이는 상태
  kind: ConsultStatusKind
  label: string                                 // 칩 글자 — 진행중 / 주문전환 / 종결 · 발주 완료 / 종결 · {사유}
  date: string | null                           // 상태 갱신일 (YYYY-MM-DD, 한국 시간)
  order_date: string | null                     // 주문일 (가장 이른)
  order_count: number                           // 취소 제외 주문 수
  order_nos: string[]
}

const kstDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(iso)) : null
const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}
// 종결 사유 표시는 짧게 — "고객 취소 · 내년 재문의" → 첫 마디
const shortReason = (r: string | null | undefined) => (r ?? '').split(/[·\n—]/)[0].trim().slice(0, 12)

export async function loadConsultStatusMap(
  admin: SupabaseClient,
  consults: { id: string; status: string | null; closed_at?: string | null; close_reason?: string | null }[],
): Promise<Map<string, ConsultStatusInfo>> {
  const out = new Map<string, ConsultStatusInfo>()
  if (!consults.length) return out
  const ids = consults.map(c => c.id)

  type O = { id: string; order_no: string; order_date: string; created_at: string; consultation_id: string; canceled_at: string | null }
  const orders: O[] = []
  await Promise.all(chunk(ids, 150).map(async ch => {
    const { data } = await admin.from('erp_orders')
      .select('id, order_no, order_date, created_at, consultation_id, canceled_at').in('consultation_id', ch)
    orders.push(...((data ?? []) as O[]))
  }))
  const byConsult = new Map<string, O[]>()
  for (const o of orders) {
    if (o.canceled_at) continue
    const arr = byConsult.get(o.consultation_id)
    if (arr) arr.push(o); else byConsult.set(o.consultation_id, [o])
  }

  // 주문전환 상담의 주문만 발주 상태 · 발주서 날짜를 본다
  const convertedOrderIds = consults.filter(c => c.status === '주문전환').flatMap(c => (byConsult.get(c.id) ?? []).map(o => o.id))
  const po = await loadPoStatusMap(admin, convertedOrderIds)
  const lastPo = new Map<string, string>()   // order_id → 마지막 유효 발주서 작성 시각
  if (convertedOrderIds.length) {
    await Promise.all(chunk(convertedOrderIds, 150).map(async ch => {
      const { data, error } = await admin.from('erp_purchase_orders').select('order_id, created_at').eq('status', 'active').in('order_id', ch)
      if (error) return
      for (const p of data ?? []) {
        const k = p.order_id as string
        if (!lastPo.has(k) || (p.created_at as string) > lastPo.get(k)!) lastPo.set(k, p.created_at as string)
      }
    }))
  }

  for (const c of consults) {
    const os = (byConsult.get(c.id) ?? []).sort((a, b) => a.order_date.localeCompare(b.order_date) || a.created_at.localeCompare(b.created_at))
    const base = { order_date: os[0]?.order_date ?? null, order_count: os.length, order_nos: os.map(o => o.order_no) }
    if (c.status === '종결') {
      const r = shortReason(c.close_reason)
      out.set(c.id, { ...base, status: '종결', kind: 'closed', label: r ? `종결 · ${r}` : '종결', date: kstDate(c.closed_at) })
      continue
    }
    if (c.status === '주문전환') {
      const firstAt = os.map(o => o.created_at).sort()[0] ?? null
      const allDone = os.length > 0 && os.every(o => po.get(o.id) === 'full')
      if (allDone) {
        const last = os.map(o => lastPo.get(o.id) ?? '').filter(Boolean).sort().pop() ?? null
        out.set(c.id, { ...base, status: '종결', kind: 'po_done', label: '종결 · 발주 완료', date: kstDate(last) })
      } else {
        out.set(c.id, { ...base, status: '주문전환', kind: 'converted', label: '주문전환', date: kstDate(firstAt) })
      }
      continue
    }
    out.set(c.id, { ...base, status: '진행중', kind: 'open', label: '진행중', date: null })
  }
  return out
}

// ── 직원 업무량 (5번) — 주문 진행 담당을 고를 때 이름 옆 숫자 ──
//  요청 대기 = 그 직원에게 와 있는 주문 진행 요청 중 아직 전환 안 된 것(진행중 · 삭제 안 됨)
//  진행 중 주문 = 그 직원이 입력한 직접 입력 주문(취소 제외) 중 발주가 끝나지 않은 것(미발주 · 부분발주) — 종결 기준과 같은 뜻
export async function loadWorkload(admin: SupabaseClient): Promise<Record<string, { req: number; orders: number }>> {
  const out: Record<string, { req: number; orders: number }> = {}
  const bump = (id: string, k: 'req' | 'orders') => { (out[id] ??= { req: 0, orders: 0 })[k] += 1 }
  let reqRes = await admin.from('erp_consultations').select('order_assignee_id')
    .eq('status', '진행중').not('order_assignee_id', 'is', null).is('deleted_at', null).limit(5000)
  if (reqRes.error && /deleted_at/i.test(reqRes.error.message)) {
    reqRes = await admin.from('erp_consultations').select('order_assignee_id')
      .eq('status', '진행중').not('order_assignee_id', 'is', null).limit(5000)
  }
  for (const r of (reqRes.data ?? []) as { order_assignee_id: string }[]) bump(r.order_assignee_id, 'req')

  const { data: ords } = await admin.from('erp_orders').select('id, created_by_employee_id')
    .eq('source', 'direct').is('canceled_at', null).not('created_by_employee_id', 'is', null).limit(5000)
  const list = (ords ?? []) as { id: string; created_by_employee_id: string }[]
  const po = await loadPoStatusMap(admin, list.map(o => o.id))
  for (const o of list) if (po.get(o.id) !== 'full') bump(o.created_by_employee_id, 'orders')
  return out
}
