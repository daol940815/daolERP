// 거래처 담당자 관리 — 집계 라이브러리
//
// 인물 마스터 = contacts (A안). 주문 귀속 규칙:
//   주문 → customer_alias → vendor → 그 거래처의 담당자 중
//   1) contact_name_links 명시 연결(무시 포함) 우선
//   2) 주문 담당자 표기(manager_name)에 인물 이름이 포함되면 귀속
// 커넥션(상담 직원)·상태(미주문 90/180일)는 전부 자동 판정 — 수동 상태 없음.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetch-all-rows'

export const NO_ORDER_WARN_DAYS = 90
export const NO_ORDER_ALERT_DAYS = 180
const RECENT_MOVE_DAYS = 30

export type ContactStatus = 'normal' | 'recent_move' | 'no_order_90' | 'no_order_180' | 'unassigned' | 'no_history'

export interface ContactListRow {
  contact_id: string
  name: string
  phone: string | null
  // 현재 소속 (활성 배정 기준 — 여러 곳이면 첫 배정 + 개수)
  vendor_id: string | null
  vendor_name: string | null
  title: string | null
  is_representative: boolean
  vendor_count: number
  ended_note: string | null          // 소속 없음일 때 마지막 소속 표기
  staff_names: string[]              // 주 상담 직원 (vendor_staff 기준, 주담당 우선)
  total_sales: number
  outstanding: number
  last_order_date: string | null
  no_order_days: number | null
  status: ContactStatus
}

export interface GapVendorRow {
  vendor_id: string
  vendor_name: string
  last_contact_name: string | null
  last_contact_note: string | null   // (이동) 등
  gap_start: string | null
  gap_days: number | null
  prev12_sales: number
  after_gap_sales: number
  staff_names: string[]
  never_assigned: boolean
}

export interface UnmatchedRow {
  vendor_id: string
  vendor_name: string
  raw_name: string
  order_count: number
  last_order_date: string
  candidates: { contact_id: string; name: string; vendor_name: string | null; same_vendor: boolean }[]
}

export interface ContactManagerBundle {
  kpi: {
    total: number
    gap_vendors: number
    unmatched: number
    attention90: number
    attention180: number
    recent_moves: number
  }
  contacts: ContactListRow[]
  gaps: GapVendorRow[]
  unmatched: UnmatchedRow[]
  staff_options: string[]            // 상담 직원 칩 (배정 빈도순)
  migration105: boolean
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toLowerCase()
const today = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) =>
  Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
const addMonths = (d: string, m: number) => {
  const t = new Date(d); t.setMonth(t.getMonth() + m); return t.toISOString().slice(0, 10)
}

async function fetchAllParallel<T>(
  admin: SupabaseClient,
  countQuery: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  pageQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[] } | { error: string }> {
  const { count, error: ce } = await countQuery()
  if (ce) return { error: ce.message }
  const totalCount = count ?? 0
  const PAGE = 1000
  const pages: [number, number][] = []
  for (let from = 0; from < totalCount; from += PAGE) pages.push([from, from + PAGE - 1])
  const rows: T[] = []
  const CONCURRENCY = 6
  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    const results = await Promise.all(pages.slice(i, i + CONCURRENCY).map(([f, t]) => pageQuery(f, t)))
    for (const r of results) {
      if (r.error) return { error: r.error.message }
      rows.push(...(r.data ?? []))
    }
  }
  return { data: rows }
}

interface OrderRow {
  id: string; order_no: string; order_date: string
  customer_alias_id: string | null; manager_name: string | null
  total_amount: number | null; outstanding_amount: number | null; collect_status: string
}
interface AsgnRow {
  id: string; contact_id: string; vendor_id: string; title: string | null
  is_representative: boolean; started_at: string | null; ended_at: string | null; created_at: string
}

export async function buildContactManagerBundle(admin: SupabaseClient): Promise<ContactManagerBundle | { error: string }> {
  const [contactsR, asgnR, vendorsR, aliasR, staffR, empR, ordersR] = await Promise.all([
    fetchAllRows<{ id: string; name: string; phone: string | null; merged_into_id: string | null }>(
      (f, t) => admin.from('contacts').select('id, name, phone, merged_into_id').range(f, t)),
    fetchAllRows<AsgnRow>(
      (f, t) => admin.from('contact_assignments')
        .select('id, contact_id, vendor_id, title, is_representative, started_at, ended_at, created_at').range(f, t)),
    fetchAllRows<{ id: string; name: string; type: string; status: string | null }>(
      (f, t) => admin.from('vendors').select('id, name, type, status').in('type', ['customer', 'both']).range(f, t)),
    fetchAllRows<{ id: string; vendor_id: string | null }>(
      (f, t) => admin.from('erp_vendor_aliases').select('id, vendor_id').eq('alias_type', 'customer').range(f, t)),
    fetchAllRows<{ vendor_id: string; employee_id: string; is_primary: boolean; ended_at: string | null }>(
      (f, t) => admin.from('vendor_staff').select('vendor_id, employee_id, is_primary, ended_at').is('ended_at', null).range(f, t)),
    fetchAllRows<{ id: string; name: string }>(
      (f, t) => admin.from('employees').select('id, name').range(f, t)),
    fetchAllParallel<OrderRow>(admin,
      () => admin.from('erp_orders').select('id', { count: 'exact', head: true }),
      (f, t) => admin.from('erp_orders')
        .select('id, order_no, order_date, customer_alias_id, manager_name, total_amount, outstanding_amount, collect_status')
        .range(f, t)),
  ])
  for (const r of [contactsR, asgnR, vendorsR, aliasR, staffR, empR, ordersR]) {
    if ('error' in r) return { error: r.error }
  }
  const contacts = (contactsR as { data: { id: string; name: string; phone: string | null; merged_into_id: string | null }[] }).data
    .filter(c => !c.merged_into_id)
  const asgns = (asgnR as { data: AsgnRow[] }).data
  const vendors = (vendorsR as { data: { id: string; name: string; type: string; status: string | null }[] }).data
    .filter(v => v.status !== 'merged')
  const aliases = (aliasR as { data: { id: string; vendor_id: string | null }[] }).data
  const staff = (staffR as { data: { vendor_id: string; employee_id: string; is_primary: boolean }[] }).data
  const emps = (empR as { data: { id: string; name: string }[] }).data
  const orders = (ordersR as { data: OrderRow[] }).data

  // 명시 연결 (105 미적용 시 빈 맵으로 폴백)
  let migration105 = true
  const links = new Map<string, string | null>()   // `${vendor_id}|${raw}` -> contact_id|null(무시)
  {
    const r = await fetchAllRows<{ vendor_id: string; raw_name: string; contact_id: string | null }>(
      (f, t) => admin.from('contact_name_links').select('vendor_id, raw_name, contact_id').range(f, t))
    if ('error' in r) {
      if (/contact_name_links/.test(r.error)) migration105 = false
      else return { error: r.error }
    } else {
      for (const l of r.data) links.set(`${l.vendor_id}|${l.raw_name.trim()}`, l.contact_id)
    }
  }

  const vendorName = new Map(vendors.map(v => [v.id, v.name]))
  const aliasToVendor = new Map<string, string>()
  for (const a of aliases) if (a.vendor_id) aliasToVendor.set(a.id, a.vendor_id)
  const empName = new Map(emps.map(e => [e.id, e.name]))

  // 거래처별 상담 직원 (주담당 우선 정렬)
  const vendorStaff = new Map<string, string[]>()
  for (const s of staff.sort((a, b) => Number(b.is_primary) - Number(a.is_primary))) {
    const n = empName.get(s.employee_id)
    if (!n) continue
    const list = vendorStaff.get(s.vendor_id) ?? []
    if (!list.includes(n)) list.push(n)
    vendorStaff.set(s.vendor_id, list)
  }

  // 거래처별 활성 담당자 (이름 매칭용)
  const activeByVendor = new Map<string, { contact_id: string; name: string; nname: string }[]>()
  const asgnByContact = new Map<string, AsgnRow[]>()
  for (const a of asgns) {
    const list = asgnByContact.get(a.contact_id) ?? []
    list.push(a); asgnByContact.set(a.contact_id, list)
    if (!a.ended_at) {
      const c = contacts.find(x => x.id === a.contact_id)
      if (!c) continue
      const v = activeByVendor.get(a.vendor_id) ?? []
      v.push({ contact_id: c.id, name: c.name, nname: norm(c.name) })
      activeByVendor.set(a.vendor_id, v)
    }
  }
  // contacts.find 반복 회피용 맵 재구성 (위 루프는 소규모지만 안전하게 교체)
  const contactById = new Map(contacts.map(c => [c.id, c]))
  activeByVendor.clear()
  for (const a of asgns) {
    if (a.ended_at) continue
    const c = contactById.get(a.contact_id)
    if (!c) continue
    const v = activeByVendor.get(a.vendor_id) ?? []
    v.push({ contact_id: c.id, name: c.name, nname: norm(c.name) })
    activeByVendor.set(a.vendor_id, v)
  }

  // ── 주문 귀속 ──
  const statByContact = new Map<string, { sales: number; outstanding: number; last: string | null; count: number }>()
  const vendorOrders = new Map<string, { date: string; amount: number }[]>()
  const unmatchedMap = new Map<string, { vendor_id: string; raw: string; count: number; last: string }>()
  for (const o of orders) {
    const vid = o.customer_alias_id ? aliasToVendor.get(o.customer_alias_id) : undefined
    if (!vid) continue
    const vo = vendorOrders.get(vid) ?? []
    vo.push({ date: o.order_date, amount: o.total_amount || 0 })
    vendorOrders.set(vid, vo)

    const raw = (o.manager_name ?? '').trim()
    let cid: string | null | undefined = undefined
    if (raw && links.has(`${vid}|${raw}`)) cid = links.get(`${vid}|${raw}`)   // null=무시
    if (cid === undefined && raw) {
      const nraw = norm(raw)
      const cands = activeByVendor.get(vid) ?? []
      const hit = cands.find(c => nraw.includes(c.nname))
      cid = hit ? hit.contact_id : undefined
    }
    if (cid) {
      const s = statByContact.get(cid) ?? { sales: 0, outstanding: 0, last: null, count: 0 }
      s.sales += o.total_amount || 0
      if (o.collect_status !== 'collected') s.outstanding += o.outstanding_amount || 0
      if (!s.last || o.order_date > s.last) s.last = o.order_date
      s.count += 1
      statByContact.set(cid, s)
    } else if (cid === undefined && raw) {
      // 미확인 큐 (무시 연결은 제외)
      const key = `${vid}|${raw}`
      const u = unmatchedMap.get(key) ?? { vendor_id: vid, raw, count: 0, last: o.order_date }
      u.count += 1
      if (o.order_date > u.last) u.last = o.order_date
      unmatchedMap.set(key, u)
    }
  }

  // ── 목록 행 ──
  const t = today()
  const rows: ContactListRow[] = []
  let attention90 = 0, attention180 = 0, recentMoves = 0
  for (const c of contacts) {
    const my = (asgnByContact.get(c.id) ?? []).sort((a, b) =>
      (b.started_at ?? b.created_at).localeCompare(a.started_at ?? a.created_at))
    const active = my.filter(a => !a.ended_at)
    const first = active[0] ?? null
    const lastEnded = my.find(a => a.ended_at)
    const stat = statByContact.get(c.id)

    // 최근 이동: 시작/종료가 30일 내 (대량 적재분은 started_at NULL → 제외)
    const moved = my.some(a =>
      (a.started_at && daysBetween(a.started_at, t) <= RECENT_MOVE_DAYS) ||
      (a.ended_at && daysBetween(a.ended_at, t) <= RECENT_MOVE_DAYS))

    let status: ContactStatus
    const noDays = stat?.last ? daysBetween(stat.last, t) : null
    if (!active.length) status = 'unassigned'
    else if (moved) status = 'recent_move'
    else if (!stat || !stat.last) status = 'no_history'
    else if (noDays! > NO_ORDER_ALERT_DAYS) status = 'no_order_180'
    else if (noDays! > NO_ORDER_WARN_DAYS) status = 'no_order_90'
    else status = 'normal'
    if (status === 'no_order_90') attention90 += 1
    if (status === 'no_order_180') { attention90 += 1; attention180 += 1 }
    if (moved) recentMoves += 1

    rows.push({
      contact_id: c.id,
      name: c.name,
      phone: c.phone,
      vendor_id: first?.vendor_id ?? null,
      vendor_name: first ? (vendorName.get(first.vendor_id) ?? null) : null,
      title: first?.title ?? null,
      is_representative: first?.is_representative ?? false,
      vendor_count: active.length,
      ended_note: !active.length && lastEnded
        ? `${vendorName.get(lastEnded.vendor_id) ?? ''} (~${lastEnded.ended_at})` : null,
      staff_names: first ? (vendorStaff.get(first.vendor_id) ?? []) : [],
      total_sales: stat?.sales ?? 0,
      outstanding: stat?.outstanding ?? 0,
      last_order_date: stat?.last ?? null,
      no_order_days: noDays,
      status,
    })
  }
  rows.sort((a, b) => b.total_sales - a.total_sales)

  // ── 담당 공백 거래처 ──
  const gaps: GapVendorRow[] = []
  const asgnByVendor = new Map<string, AsgnRow[]>()
  for (const a of asgns) {
    const list = asgnByVendor.get(a.vendor_id) ?? []
    list.push(a); asgnByVendor.set(a.vendor_id, list)
  }
  const cutoff12 = addMonths(t, -12)
  for (const v of vendors) {
    const va = asgnByVendor.get(v.id) ?? []
    if (va.some(a => !a.ended_at)) continue
    const vo = vendorOrders.get(v.id) ?? []
    const prev12 = vo.filter(o => o.date >= cutoff12).reduce((s, o) => s + o.amount, 0)
    const everAssigned = va.length > 0
    if (!everAssigned && prev12 <= 0) continue   // 잠재도 매출도 없으면 제외
    const lastEnded = va.filter(a => a.ended_at).sort((a, b) => b.ended_at!.localeCompare(a.ended_at!))[0]
    const lastContact = lastEnded ? contactById.get(lastEnded.contact_id) : null
    // 이동 여부: 그 인물이 다른 곳에 활성 배정이 있는가
    let note: string | null = null
    if (lastContact) {
      const nowActive = (asgnByContact.get(lastContact.id) ?? []).find(a => !a.ended_at)
      note = nowActive ? `${vendorName.get(nowActive.vendor_id) ?? ''}(으)로 이동` : '후임 미지정'
    }
    const afterGap = lastEnded
      ? vo.filter(o => o.date > lastEnded.ended_at!).reduce((s, o) => s + o.amount, 0)
      : 0
    gaps.push({
      vendor_id: v.id,
      vendor_name: v.name,
      last_contact_name: lastContact?.name ?? null,
      last_contact_note: note,
      gap_start: lastEnded?.ended_at ?? null,
      gap_days: lastEnded ? daysBetween(lastEnded.ended_at!, t) : null,
      prev12_sales: prev12,
      after_gap_sales: afterGap,
      staff_names: vendorStaff.get(v.id) ?? [],
      never_assigned: !everAssigned,
    })
  }
  gaps.sort((a, b) => b.prev12_sales - a.prev12_sales)

  // ── 미확인 담당자명 큐 ──
  const nameToContacts = new Map<string, { contact_id: string; vendor_id: string | null }[]>()
  for (const c of contacts) {
    const first = (asgnByContact.get(c.id) ?? []).find(a => !a.ended_at)
    const list = nameToContacts.get(norm(c.name)) ?? []
    list.push({ contact_id: c.id, vendor_id: first?.vendor_id ?? null })
    nameToContacts.set(norm(c.name), list)
  }
  const stripTitle = (raw: string) => {
    const s = raw.replace(/님$/, '').trim()
    const toks = s.split(/\s+/)
    return toks.length >= 2 ? toks.slice(0, -1).join(' ') : s
  }
  const unmatched: UnmatchedRow[] = Array.from(unmatchedMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 300)
    .map(u => {
      const cand = (nameToContacts.get(norm(stripTitle(u.raw))) ?? []).slice(0, 3).map(c => ({
        contact_id: c.contact_id,
        name: contactById.get(c.contact_id)?.name ?? '',
        vendor_name: c.vendor_id ? (vendorName.get(c.vendor_id) ?? null) : null,
        same_vendor: c.vendor_id === u.vendor_id,
      }))
      return {
        vendor_id: u.vendor_id,
        vendor_name: vendorName.get(u.vendor_id) ?? '',
        raw_name: u.raw,
        order_count: u.count,
        last_order_date: u.last,
        candidates: cand,
      }
    })

  // 상담 직원 옵션 (배정 빈도순)
  const staffFreq = new Map<string, number>()
  for (const r of rows) for (const n of r.staff_names) staffFreq.set(n, (staffFreq.get(n) ?? 0) + 1)
  const staff_options = Array.from(staffFreq.entries()).sort((a, b) => b[1] - a[1]).map(([n]) => n)

  return {
    kpi: {
      total: rows.length,
      gap_vendors: gaps.length,
      unmatched: unmatched.length,
      attention90,
      attention180,
      recent_moves: recentMoves,
    },
    contacts: rows,
    gaps,
    unmatched,
    staff_options,
    migration105,
  }
}

// ── 상세 ─────────────────────────────────────────────
export interface ContactDetail {
  contact: { id: string; name: string; phone: string | null; email: string | null; note: string | null }
  assignments: {
    id: string; vendor_id: string; vendor_name: string; title: string | null
    is_representative: boolean; started_at: string | null; ended_at: string | null
    vendor_gap: boolean            // 종료 후 그 거래처에 후임이 없는가
  }[]
  connections: { name: string; count: number; sales: number }[]
  orders: {
    id: string; order_no: string; order_date: string; vendor_name: string
    total_amount: number; outstanding: number
  }[]
  stats: { total_sales: number; outstanding: number; last_order_date: string | null; order_count: number }
  activities: {
    id: string; activity_date: string; activity_type: string; content: string
    next_action: string | null; employee_name: string | null; vendor_name: string | null
  }[]
  same_name: { contact_id: string; name: string; vendor_name: string | null }[]
  employees: { id: string; name: string }[]
  migration105: boolean
}

export async function buildContactDetail(admin: SupabaseClient, contactId: string): Promise<ContactDetail | { error: string }> {
  const { data: contact, error: ce } = await admin
    .from('contacts').select('id, name, phone, email, note').eq('id', contactId).single()
  if (ce || !contact) return { error: ce?.message ?? '인물을 찾을 수 없습니다.' }

  const [asgnR, empR] = await Promise.all([
    fetchAllRows<AsgnRow>((f, t) => admin.from('contact_assignments')
      .select('id, contact_id, vendor_id, title, is_representative, started_at, ended_at, created_at')
      .eq('contact_id', contactId).range(f, t)),
    fetchAllRows<{ id: string; name: string }>((f, t) =>
      admin.from('employees').select('id, name').eq('is_active', true).range(f, t)),
  ])
  if ('error' in asgnR) return { error: asgnR.error }
  if ('error' in empR) return { error: empR.error }
  const my = asgnR.data.sort((a, b) =>
    (b.started_at ?? b.created_at).localeCompare(a.started_at ?? a.created_at))

  const vendorIds = Array.from(new Set(my.map(a => a.vendor_id)))
  const [vendorsR, aliasR, otherAsgnR] = await Promise.all([
    vendorIds.length
      ? admin.from('vendors').select('id, name').in('id', vendorIds)
      : Promise.resolve({ data: [], error: null }),
    vendorIds.length
      ? fetchAllRows<{ id: string; vendor_id: string }>((f, t) => admin.from('erp_vendor_aliases')
          .select('id, vendor_id').eq('alias_type', 'customer').in('vendor_id', vendorIds).range(f, t))
      : Promise.resolve({ data: [] as { id: string; vendor_id: string }[] }),
    vendorIds.length
      ? fetchAllRows<{ vendor_id: string; ended_at: string | null }>((f, t) => admin.from('contact_assignments')
          .select('vendor_id, ended_at').in('vendor_id', vendorIds).range(f, t))
      : Promise.resolve({ data: [] as { vendor_id: string; ended_at: string | null }[] }),
  ])
  if (vendorsR.error) return { error: vendorsR.error.message }
  if ('error' in aliasR) return { error: aliasR.error }
  if ('error' in otherAsgnR) return { error: otherAsgnR.error }
  const vName = new Map((vendorsR.data ?? []).map(v => [v.id as string, v.name as string]))
  const aliasIds = aliasR.data.map(a => a.id)
  const aliasVendor = new Map(aliasR.data.map(a => [a.id, a.vendor_id]))
  const vendorHasActive = new Set(otherAsgnR.data.filter(a => !a.ended_at).map(a => a.vendor_id))

  // 배정 거래처들의 주문 → 이름/연결 매칭
  const nname = norm(contact.name)
  let orders: OrderRow[] = []
  for (let i = 0; i < aliasIds.length; i += 100) {
    const chunk = aliasIds.slice(i, i + 100)
    const r = await fetchAllRows<OrderRow>((f, t) => admin.from('erp_orders')
      .select('id, order_no, order_date, customer_alias_id, manager_name, total_amount, outstanding_amount, collect_status')
      .in('customer_alias_id', chunk).range(f, t))
    if ('error' in r) return { error: r.error }
    orders = orders.concat(r.data)
  }
  let migration105 = true
  const links = new Map<string, string | null>()
  if (vendorIds.length) {
    const r = await fetchAllRows<{ vendor_id: string; raw_name: string; contact_id: string | null }>(
      (f, t) => admin.from('contact_name_links').select('vendor_id, raw_name, contact_id')
        .in('vendor_id', vendorIds).range(f, t))
    if ('error' in r) {
      if (/contact_name_links/.test(r.error)) migration105 = false
      else return { error: r.error }
    } else for (const l of r.data) links.set(`${l.vendor_id}|${l.raw_name.trim()}`, l.contact_id)
  }
  const mine = orders.filter(o => {
    const vid = o.customer_alias_id ? aliasVendor.get(o.customer_alias_id) : undefined
    if (!vid) return false
    const raw = (o.manager_name ?? '').trim()
    if (raw && links.has(`${vid}|${raw}`)) return links.get(`${vid}|${raw}`) === contactId
    return raw ? norm(raw).includes(nname) : false
  }).sort((a, b) => b.order_date.localeCompare(a.order_date))

  // 커넥션: 품목의 상담자(channel) 집계
  const conn = new Map<string, { count: number; sales: number }>()
  const mineIds = mine.map(o => o.id)
  for (let i = 0; i < mineIds.length; i += 150) {
    const chunk = mineIds.slice(i, i + 150)
    const r = await fetchAllRows<{ order_id: string; channel: string | null; line_total: number | null }>(
      (f, t) => admin.from('erp_order_items').select('order_id, channel, line_total')
        .in('order_id', chunk).range(f, t))
    if ('error' in r) return { error: r.error }
    const seen = new Map<string, Set<string>>()
    for (const it of r.data) {
      const ch = (it.channel ?? '').trim()
      if (!ch) continue
      const c = conn.get(ch) ?? { count: 0, sales: 0 }
      c.sales += it.line_total || 0
      const s = seen.get(ch) ?? new Set<string>()
      if (!s.has(it.order_id)) { c.count += 1; s.add(it.order_id) }
      seen.set(ch, s)
      conn.set(ch, c)
    }
  }
  const connections = Array.from(conn.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.sales - a.sales).slice(0, 8)

  // 영업일지 (105 미적용 폴백)
  let activities: ContactDetail['activities'] = []
  {
    const r = await admin.from('contact_activities')
      .select('id, activity_date, activity_type, content, next_action, vendor_id, employees(name)')
      .eq('contact_id', contactId).order('activity_date', { ascending: false }).limit(200)
    if (r.error) {
      if (!/contact_activities/.test(r.error.message)) return { error: r.error.message }
      migration105 = false
    } else {
      activities = (r.data ?? []).map(a => ({
        id: a.id as string,
        activity_date: a.activity_date as string,
        activity_type: a.activity_type as string,
        content: a.content as string,
        next_action: (a.next_action as string | null) ?? null,
        employee_name: (a.employees as unknown as { name: string } | null)?.name ?? null,
        vendor_name: a.vendor_id ? (vName.get(a.vendor_id as string) ?? null) : null,
      }))
    }
  }

  // 동명이인 후보 (병합용)
  const { data: sameRaw } = await admin.from('contacts')
    .select('id, name, contact_assignments(vendor_id, ended_at)')
    .eq('name', contact.name).neq('id', contactId).is('merged_into_id', null).limit(10)
  const sameVendorIds = Array.from(new Set((sameRaw ?? []).flatMap(s =>
    ((s.contact_assignments as unknown as { vendor_id: string; ended_at: string | null }[]) ?? [])
      .filter(a => !a.ended_at).map(a => a.vendor_id))))
  const svNames = new Map<string, string>()
  if (sameVendorIds.length) {
    const { data } = await admin.from('vendors').select('id, name').in('id', sameVendorIds)
    for (const v of data ?? []) svNames.set(v.id, v.name)
  }
  const same_name = (sameRaw ?? []).map(s => {
    const act = ((s.contact_assignments as unknown as { vendor_id: string; ended_at: string | null }[]) ?? [])
      .find(a => !a.ended_at)
    return { contact_id: s.id as string, name: s.name as string,
      vendor_name: act ? (svNames.get(act.vendor_id) ?? null) : null }
  })

  const totalSales = mine.reduce((s, o) => s + (o.total_amount || 0), 0)
  const outstanding = mine.filter(o => o.collect_status !== 'collected')
    .reduce((s, o) => s + (o.outstanding_amount || 0), 0)

  return {
    contact,
    assignments: my.map(a => ({
      id: a.id, vendor_id: a.vendor_id, vendor_name: vName.get(a.vendor_id) ?? '',
      title: a.title, is_representative: a.is_representative,
      started_at: a.started_at, ended_at: a.ended_at,
      vendor_gap: !!a.ended_at && !vendorHasActive.has(a.vendor_id),
    })),
    connections,
    orders: mine.slice(0, 100).map(o => ({
      id: o.id, order_no: o.order_no, order_date: o.order_date,
      vendor_name: o.customer_alias_id ? (vName.get(aliasVendor.get(o.customer_alias_id) ?? '') ?? '') : '',
      total_amount: o.total_amount || 0,
      outstanding: o.collect_status !== 'collected' ? (o.outstanding_amount || 0) : 0,
    })),
    stats: {
      total_sales: totalSales, outstanding,
      last_order_date: mine[0]?.order_date ?? null, order_count: mine.length,
    },
    activities,
    same_name,
    employees: empR.data,
    migration105,
  }
}
