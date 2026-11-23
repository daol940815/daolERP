// 고객 쌍방향 추천 — 담당자 이름 · 핸드폰으로 소속(업체 · 지점)까지 찾는다
// (2026-11-18 사용자 승인 — 시안 docs/mockups/고객_쌍방향추천_시안.html)
//  - 이름 2글자 이상 · 번호 숫자 4개 이상. 결과 최대 20명.
//  - 대상: 거래처 담당자 마스터(병합된 인물 제외) 중 **활성 매출처에 현재 소속**이 있는 사람만 (2026-11-19 수정 —
//    비활성 · 병합 · 매입처 소속이 '최근 소속'으로 나와 고를 수 있던 결함. 매출처관리와 같은 기준: type customer · both, 활성, 병합 제외).
//    이전 소속(인사이동 안내)도 활성 매출처의 끝난 배정만 보여준다.
//  - 정렬: 현재 소속이 있는 사람 → 최근 주문일 → 이름. 소속은 현재 → 이전(끝난 날짜 최근순).
//  - 고를 때만 채운다(화면). 여기는 조회만 한다.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface CustomerAsg {
  vendor_id: string
  vendor_name: string
  group_id: string | null
  group_name: string | null
  individual: boolean            // 개인 고객 전용 매출처(115)
  title: string | null
  staff_employee_id: string | null
  current: boolean               // 현재 소속 (배정 진행 중 · 매출처 활성)
  ended_at: string | null
}
export interface CustomerHit {
  contact_id: string
  name: string
  phone: string | null
  tel: string | null
  exact: boolean                 // 번호 전체 일치
  last_order: string | null
  assignments: CustomerAsg[]
}

export const digitsOf = (v: unknown) => String(v ?? '').replace(/\D/g, '')
// 번호 검색인지: 숫자 · 기호만 있고 숫자가 4개 이상
export const isPhoneQuery = (q: string) => /^[\d\s\-()+.]+$/.test(q.trim()) && digitsOf(q).length >= 4
// 이름 검색어: "김민수 과장님" → "김민수"
export const nameOfQuery = (q: string) => q.trim().replace(/님$/, '').trim().split(/\s+/)[0] ?? ''

type ContactRow = { id: string; name: string; phone: string | null; tel?: string | null }

export async function searchCustomers(admin: SupabaseClient, q: string): Promise<CustomerHit[]> {
  const query = q.trim()
  const phoneMode = isPhoneQuery(query)
  const digits = digitsOf(query)
  const name = nameOfQuery(query)
  if (!phoneMode && name.length < 2) return []

  // 1) 인물 후보 — 유선(116) 칸이 없으면 핸드폰만
  const pick = async (withTel: boolean) => {
    const cols = withTel ? 'id, name, phone, tel' : 'id, name, phone'
    let b = admin.from('contacts').select(cols).is('merged_into_id', null)
    if (phoneMode) {
      const tail = digits.slice(-4)
      b = withTel ? b.or(`phone.ilike.%${tail}%,tel.ilike.%${tail}%`) : b.ilike('phone', `%${tail}%`)
    } else {
      b = b.ilike('name', `%${name}%`)
    }
    return b.limit(200)
  }
  let res = await pick(true)
  if (res.error && /\btel\b/i.test(res.error.message)) res = await pick(false)
  if (res.error) return []
  let people = (res.data ?? []) as unknown as ContactRow[]
  const exactOf = (c: ContactRow) => phoneMode && digits.length >= 9
    && (digitsOf(c.phone) === digits || digitsOf(c.tel) === digits)
  if (phoneMode) {
    // 숫자만 비교 — 친 숫자가 번호 안에 그대로 들어 있어야 한다
    people = people.filter(c => digitsOf(c.phone).includes(digits) || digitsOf(c.tel).includes(digits))
  }
  if (!people.length) return []
  const ids = people.map(c => c.id).slice(0, 150)

  // 2) 소속 · 최근 주문 (병렬). 다올 담당(112) 칸이 없으면 없이
  const asgSel = (withStaff: boolean) => admin.from('contact_assignments')
    .select(`contact_id, vendor_id, title, ended_at${withStaff ? ', staff_employee_id' : ''}`)
    .in('contact_id', ids)
  const [asgRes0, ordRes] = await Promise.all([
    asgSel(true),
    admin.from('erp_orders').select('contact_id, order_date').in('contact_id', ids)
      .order('order_date', { ascending: false }).limit(1000),
  ])
  const asgRes = asgRes0.error && /staff_employee_id/.test(asgRes0.error.message) ? await asgSel(false) : asgRes0
  const asgs = ((asgRes.data ?? []) as unknown as Record<string, unknown>[])
  const vendorIds = Array.from(new Set(asgs.map(a => String(a.vendor_id))))
  if (!vendorIds.length) return []

  const vSel = (with115: boolean) => admin.from('vendors')
    .select(`id, name, type, group_id, is_active, status${with115 ? ', individual_contact_id' : ''}`).in('id', vendorIds)
  let vRes = await vSel(true)
  if (vRes.error) vRes = await vSel(false)
  const vendors = new Map(((vRes.data ?? []) as unknown as Record<string, unknown>[]).map(v => [String(v.id), v]))
  const groupIds = Array.from(new Set(Array.from(vendors.values()).map(v => v.group_id).filter(Boolean) as string[]))
  const { data: groups } = groupIds.length
    ? await admin.from('vendor_groups').select('id, name').in('id', groupIds)
    : { data: [] as { id: string; name: string }[] }
  const groupName = new Map((groups ?? []).map(g => [g.id as string, g.name as string]))

  const lastOrder = new Map<string, string>()
  for (const o of (ordRes.data ?? []) as { contact_id: string; order_date: string }[]) {
    if (!lastOrder.has(o.contact_id)) lastOrder.set(o.contact_id, o.order_date)
  }

  const hits: CustomerHit[] = []
  for (const c of people) {
    const list: CustomerAsg[] = asgs.filter(a => a.contact_id === c.id).flatMap(a => {
      const v = vendors.get(String(a.vendor_id))
      // 매출처관리에 보이는 거래처만 — 비활성 · 병합 · 매입처는 현재든 이전이든 보이지 않는다
      if (!v || v.is_active === false || v.status === 'merged' || !['customer', 'both'].includes(String(v.type))) return []
      const active = true
      const gid = (v.group_id as string | null) ?? null
      return [{
        vendor_id: String(v.id), vendor_name: String(v.name ?? ''),
        group_id: gid, group_name: gid ? groupName.get(gid) ?? null : null,
        individual: !!v.individual_contact_id,
        title: (a.title as string | null) ?? null,
        staff_employee_id: (a.staff_employee_id as string | null | undefined) ?? null,
        current: !a.ended_at && active,
        ended_at: (a.ended_at as string | null) ?? null,
      }]
    })
    if (!list.some(x => x.current)) continue     // 고를 수 있는 현재 소속이 없으면 결과에서 뺀다
    list.sort((x, y) => Number(y.current) - Number(x.current) || String(y.ended_at ?? '').localeCompare(String(x.ended_at ?? '')))
    hits.push({
      contact_id: c.id, name: c.name, phone: c.phone ?? null, tel: c.tel ?? null,
      exact: exactOf(c), last_order: lastOrder.get(c.id) ?? null, assignments: list,
    })
  }
  hits.sort((a, b) =>
    Number(b.exact) - Number(a.exact)
    || Number(b.assignments.some(x => x.current)) - Number(a.assignments.some(x => x.current))
    || String(b.last_order ?? '').localeCompare(String(a.last_order ?? ''))
    || a.name.localeCompare(b.name, 'ko'))
  return hits.slice(0, 20)
}
