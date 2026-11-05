import type { SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────
// 인물 자동 판별 파이프라인 (2026-10-16 사용자 승인)
//
// 목표: 직원이 상담일지·주문만 쓰면 주문자(고객) 관리가 자동으로 된다.
// 저장 시 (거래처, 담당자 표기, 전화번호)로 인물을 판별한다:
//   1) 핸드폰 번호 일치 → 동일인 확정. 소속이 다르면 새 배정 자동 생성(이동 감지)
//      — 이전 배정은 자동 종료하지 않는다 (여러 거래처 겸임 인물이 실존하므로
//        종료는 확인 대기 큐에서 사용자가 1클릭으로). 'moved' 이벤트 기록.
//   2) 같은 거래처 + 같은 이름(현재 배정) → 기존 인물 귀속.
//   3) 같은 이름이 다른 거래처에만 있음 → 자동 병합하지 않고 별개 인물 생성
//      ('동명이인 기본값' — 17명 판정 중 16명이 동명이인). 'name_conflict' 이벤트.
//   4) 어디에도 없음 → 인물+배정 자동 생성. 'auto_created' 이벤트.
// 추천·기록은 시스템, 확정은 사용자: 자동 생성·이동·충돌은 전부
// contact_review_events에 남아 매출처 관리 (고객) 확인 대기 탭에서 정리한다.
// ─────────────────────────────────────────────────────────

// 붙여 쓴 직함('권오병부장') 분리용 사전. 띄어 쓴 표기는 사전과 무관하게 첫 토큰을 이름으로 본다 —
// 직함은 종류가 끝이 없어(주무관·복지사·대령·프로·부센터장…) 사전 방식은 이름에 직함이 붙어
// 저장되는 사고를 낸다(2026-11-02 매출처 정비에서 132명 발생·복구).
const GLUED_TITLES = [
  '부지점장', '부센터장', '지점장', '센터장', '지부장', '본부장', '사무장', '사무국장', '지사장',
  '부부장', '부장', '차장', '과장', '대리', '주임', '사원', '계장', '팀장', '실장', '국장',
  '소장', '원장', '단장', '매니저', '주무관', '복지사', '이사', '상무', '전무', '대표',
]

// 한글 2~4자지만 사람 이름이 아닌 표기 — 이름 자리에 오면 인명으로 보지 않는다
const NON_PERSON = new Set(['지점', '본점', '담당', '담당자', '고객', '개인', '미정', '없음', '직원', '회원', '총무', '본사', '부서'])

export interface ParsedName { name: string; title: string | null }

// 담당자 표기 → 순수 이름 + 직함. 사람 이름으로 보기 어려우면 null (수동 정리 큐 잔류).
//   '송은서 주무관님' → 송은서 / 주무관   ·  '김소정 PB팀장님' → 김소정 / PB팀장
//   '이현준지점장님' → 이현준 / 지점장    ·  '박제현 님' → 박제현 / null
export function parseManagerName(raw: string | null | undefined): ParsedName | null {
  const s = (raw ?? '').trim().replace(/님$/, '').trim()
  if (!s) return null
  const tokens = s.split(/\s+/)
  if (NON_PERSON.has(tokens[0])) return null
  if (tokens.length >= 2 && /^[가-힣]{2,4}$/.test(tokens[0])) {
    const title = tokens.slice(1).join(' ').replace(/님$/, '').trim()
    return { name: tokens[0], title: title || null }
  }
  if (tokens.length === 1) {
    const w = tokens[0]
    if (/^[가-힣]{2,4}$/.test(w)) return { name: w, title: null }
    for (const t of GLUED_TITLES) {
      const head = w.slice(0, -t.length)
      if (w.endsWith(t) && /^[가-힣]{2,4}$/.test(head)) return { name: head, title: t }
    }
  }
  // 한글 2~4자 이름을 찾지 못하면 인명으로 보지 않는다 — '지점', '담당자없음', 숫자 등
  return null
}

// 전화번호 정규화 — 숫자만. 핸드폰(01x)만 동일인 판별의 강한 키로 쓴다
// (유선 대표번호는 지점 공용이라 보조 신호도 못 됨).
export function normPhone(s: string | null | undefined): string | null {
  const d = (s ?? '').replace(/\D/g, '')
  return d.length >= 9 ? d : null
}
export function isMobile(d: string | null): boolean {
  return !!d && /^01[016789]\d{7,8}$/.test(d)
}

export interface ResolveInput {
  vendorId: string
  rawName: string                 // 담당자 표기 원문 (직함·존칭 포함 가능)
  phone?: string | null           // 핸드폰
  tel?: string | null             // 유선(보조 — 판별 키로는 쓰지 않음)
  source: 'consultation' | 'order_upload' | 'order_form'
  eventDate?: string | null       // 배정 시작일로 쓸 날짜 (주문일·상담일)
}

export interface ResolveResult {
  contactId: string
  action: 'matched' | 'moved' | 'created' | 'conflict_created'
}

interface ContactRow { id: string; name: string; phone: string | null; code?: string | null; merged_into_id: string | null }
interface AsgRow { id: string; contact_id: string; vendor_id: string; ended_at: string | null; vendors?: { name?: string } | null }

// 인물 판별 + 필요한 생성·배정·이벤트 기록까지 수행. 실패 시 null (저장 흐름은 계속).
export async function resolveContact(admin: SupabaseClient, input: ResolveInput): Promise<ResolveResult | null> {
  try {
    const parsed = parseManagerName(input.rawName)
    if (!parsed) return null
    const mobile = (() => { const d = normPhone(input.phone); return isMobile(d) ? d : null })()
    const startedAt = input.eventDate ?? new Date().toISOString().slice(0, 10)

    // 후보 수집: 이름 일치 + (핸드폰 있으면) 번호 일치
    const { data: byName } = await admin.from('contacts')
      .select('id, name, phone, code, merged_into_id')
      .eq('name', parsed.name).is('merged_into_id', null).limit(50)
    let byPhone: ContactRow[] = []
    if (mobile) {
      const tail = mobile.slice(-4)
      const { data } = await admin.from('contacts')
        .select('id, name, phone, code, merged_into_id')
        .not('phone', 'is', null).ilike('phone', `%${tail}`).is('merged_into_id', null).limit(50)
      byPhone = ((data ?? []) as ContactRow[]).filter(c => normPhone(c.phone) === mobile)
    }
    const nameCands = (byName ?? []) as ContactRow[]
    const candIds = Array.from(new Set([...nameCands, ...byPhone].map(c => c.id)))
    let asgs: AsgRow[] = []
    if (candIds.length) {
      const { data } = await admin.from('contact_assignments')
        .select('id, contact_id, vendor_id, ended_at, vendors(name)')
        .in('contact_id', candIds)
      asgs = (data ?? []) as unknown as AsgRow[]
    }
    const activeOf = (cid: string) => asgs.filter(a => a.contact_id === cid && !a.ended_at)

    const logEvent = async (contactId: string, type: 'auto_created' | 'moved' | 'name_conflict', detail: Record<string, unknown>) => {
      // 110 미적용 환경에서는 조용히 건너뛴다 (판별 자체는 동작)
      await admin.from('contact_review_events').insert({
        contact_id: contactId, vendor_id: input.vendorId, event_type: type,
        source: input.source,
        detail: { raw_name: input.rawName, name: parsed.name, title: parsed.title, phone: input.phone ?? null, ...detail },
      })
    }
    const addAssignment = async (contactId: string) => {
      await admin.from('contact_assignments').insert({
        contact_id: contactId, vendor_id: input.vendorId,
        title: parsed.title, is_representative: false, started_at: startedAt,
      })
    }

    // 1) 핸드폰 일치 → 동일인 (이름까지 같은 후보 우선)
    if (byPhone.length) {
      const person = byPhone.find(c => c.name === parsed.name) ?? byPhone[0]
      const actives = activeOf(person.id)
      if (actives.some(a => a.vendor_id === input.vendorId)) {
        return { contactId: person.id, action: 'matched' }
      }
      // 이동 감지: 새 소속 배정 자동 생성. 이전 배정 종료는 확인 대기에서 1클릭.
      await addAssignment(person.id)
      await logEvent(person.id, 'moved', {
        prev_assignments: actives.map(a => ({ assignment_id: a.id, vendor_id: a.vendor_id, vendor_name: a.vendors?.name ?? null })),
      })
      return { contactId: person.id, action: 'moved' }
    }

    // 2) 같은 거래처 + 같은 이름 (현재 배정) → 기존 인물
    const sameVendor = nameCands.find(c => activeOf(c.id).some(a => a.vendor_id === input.vendorId))
    if (sameVendor) return { contactId: sameVendor.id, action: 'matched' }

    // 3)·4) 신규 생성 — 같은 이름이 다른 곳에 있으면 동명 충돌 이벤트로 기록
    const { data: created, error: cErr } = await admin.from('contacts')
      .insert({ name: parsed.name, phone: input.phone?.trim() || null, note: null })
      .select('id').single()
    if (cErr || !created) return null
    await addAssignment(created.id as string)
    if (nameCands.length) {
      await logEvent(created.id as string, 'name_conflict', {
        candidates: nameCands.map(c => ({
          contact_id: c.id, name: c.name, code: c.code ?? null,
          vendors: activeOf(c.id).map(a => a.vendors?.name ?? null).filter(Boolean),
        })),
      })
      return { contactId: created.id as string, action: 'conflict_created' }
    }
    await logEvent(created.id as string, 'auto_created', {})
    return { contactId: created.id as string, action: 'created' }
  } catch {
    return null   // 판별 실패가 저장 자체를 막지 않는다
  }
}

// ── ERP 업로드 배치: (거래처, 담당자 표기) 조합 단위 자동 연결 ──────────
// 이미 명시 연결(contact_name_links)이 있으면 건너뛰고, 그 거래처 배정 인물의
// 이름이 표기에 포함되면 그 인물로 연결(기존 귀속 규칙과 동일), 아니면 resolve.
// 연결 결과는 contact_name_links에 기록해 다음 업로드부터 재판별하지 않는다.

export interface ManagerCombo {
  vendorId: string; rawName: string
  phone?: string | null; tel?: string | null; eventDate?: string | null
}
export interface AutoLinkStats {
  linked_existing: number   // 기존 인물에 연결
  created: number           // 신규 인물 자동 생성
  moved: number             // 이동 감지 (새 소속 배정)
  conflicts: number         // 동명 충돌 — 별개 인물 생성 (확인 대기)
  skipped: number           // 비인명 표기 등 판별 불가 (수동 정리 큐 잔류)
}

export async function autoLinkOrderManagers(admin: SupabaseClient, combos: ManagerCombo[]): Promise<AutoLinkStats> {
  const stats: AutoLinkStats = { linked_existing: 0, created: 0, moved: 0, conflicts: 0, skipped: 0 }
  if (!combos.length) return stats
  try {
    const vendorIds = Array.from(new Set(combos.map(c => c.vendorId)))
    const existing = new Set<string>()
    const assignedByVendor = new Map<string, { contact_id: string; name: string }[]>()
    for (let i = 0; i < vendorIds.length; i += 100) {
      const slice = vendorIds.slice(i, i + 100)
      const [{ data: links }, { data: asgs }] = await Promise.all([
        admin.from('contact_name_links').select('vendor_id, raw_name').in('vendor_id', slice).limit(10000),
        admin.from('contact_assignments').select('vendor_id, contact_id, contacts(name)')
          .in('vendor_id', slice).is('ended_at', null).limit(10000),
      ])
      for (const l of (links ?? [])) existing.add(`${l.vendor_id}|${l.raw_name}`)
      for (const a of (asgs ?? [])) {
        const name = ((a as { contacts?: { name?: string } | null }).contacts?.name ?? '').trim()
        if (!name) continue
        const arr = assignedByVendor.get(a.vendor_id as string) ?? []
        arr.push({ contact_id: a.contact_id as string, name })
        assignedByVendor.set(a.vendor_id as string, arr)
      }
    }

    for (const c of combos) {
      if (existing.has(`${c.vendorId}|${c.rawName}`)) continue
      const hit = (assignedByVendor.get(c.vendorId) ?? []).find(a => a.name.length >= 2 && c.rawName.includes(a.name))
      let contactId = hit?.contact_id ?? null
      if (contactId) stats.linked_existing++
      else {
        const r = await resolveContact(admin, { ...c, source: 'order_upload' })
        if (!r) { stats.skipped++; continue }
        contactId = r.contactId
        if (r.action === 'matched') stats.linked_existing++
        else if (r.action === 'moved') stats.moved++
        else if (r.action === 'conflict_created') stats.conflicts++
        else stats.created++
      }
      await admin.from('contact_name_links')
        .upsert({ vendor_id: c.vendorId, raw_name: c.rawName, contact_id: contactId },
          { onConflict: 'vendor_id,raw_name', ignoreDuplicates: true })
    }
  } catch { /* 자동 연결 실패가 업로드를 막지 않는다 */ }
  return stats
}
