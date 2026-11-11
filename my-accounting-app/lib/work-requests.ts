// 업무 요청 — 공용 타입·라벨·판정 (docs/work-request-track.md, 900·901·902)
// 요청 상태: requested → accepted → in_progress → done_reported → completed / canceled / rejected
// 902(2026-11-02): 담당자 다수 지정. 담당자별 상태(work_request_assignees)가 원본이고 요청 상태는 그 집계다.
//   진행 방식 assign_mode — single(1명) / first(선착: 먼저 수락한 1명, 나머지 released) / all(공동: 전원 각자, 전원 보고 시 처리 보고)

export type WrStatus = 'requested' | 'accepted' | 'in_progress' | 'done_reported' | 'completed' | 'canceled' | 'rejected'
export type WrEvent = 'created' | 'accepted' | 'rejected' | 'memo' | 'reported' | 'completed' | 'canceled' | 'edited' | 'assignee_added' | 'tags_changed'
export type WrMode = 'single' | 'first' | 'all'
export type WrAsgStatus = 'invited' | 'accepted' | 'in_progress' | 'done_reported' | 'rejected' | 'released'

export const WR_STATUS_LABEL: Record<WrStatus, string> = {
  requested: '미확인', accepted: '수락', in_progress: '진행 중', done_reported: '완료 확정 대기',
  completed: '완료', canceled: '취소', rejected: '반려',
}
// 2026-11-11 사용자 결정: 요청 상태 done_reported 의 이름 = '완료 확정 대기'(이전 '처리 보고' — KPI '완료 대기' · 알림 '완료 확정 대기'와 제각각이었음).
//  '처리 보고'는 담당자의 행위 이름으로만 남긴다(버튼 · 이력 · PC 알림 제목 · 공동 요청의 담당자별 상태 WR_ASG_LABEL).
// 상태 배지에 마우스를 올리면 뜨는 설명 — 누구 차례인지 헷갈릴 수 있는 상태만
export const WR_STATUS_HINT: Partial<Record<WrStatus, string>> = {
  done_reported: '담당자가 처리 보고함 — 요청자의 완료 확정을 기다리는 중',
}
export const WR_STATUS_CLS: Record<WrStatus, string> = {
  requested: 'bg-gray-100 text-gray-600', accepted: 'bg-blue-100 text-blue-700', in_progress: 'bg-indigo-100 text-indigo-700',
  done_reported: 'bg-amber-100 text-amber-700', completed: 'bg-green-100 text-green-700',
  canceled: 'bg-gray-100 text-gray-400 line-through', rejected: 'bg-red-100 text-red-700',
}
export const WR_EVENT_LABEL: Record<WrEvent, string> = {
  created: '요청 생성', accepted: '수락', rejected: '반려', memo: '진행 메모', reported: '처리 완료 보고',
  completed: '완료 확정', canceled: '요청 취소', edited: '요청 수정', assignee_added: '담당자 추가', tags_changed: '태그 변경',
}
export const WR_MODE_LABEL: Record<WrMode, string> = { single: '단일', first: '선착', all: '공동' }
export const WR_MODE_DESC: Record<WrMode, string> = {
  single: '담당자 1명',
  first: '먼저 수락한 1명이 진행합니다. 나머지는 자동 해제되어 할 일에서 사라지고 "다른 사람이 수락"으로 참고 표시만 남습니다.',
  all: '지정된 모두가 각자 수락 · 진행 · 처리 보고합니다. 전원이 보고하면 요청이 "완료 확정 대기"가 되고 요청자가 1회 완료 확정합니다.',
}
// 담당자별 상태 라벨 — released 는 선착에서 다른 사람이 수락한 경우
export const WR_ASG_LABEL: Record<WrAsgStatus, string> = {
  invited: '미확인', accepted: '수락', in_progress: '진행 중', done_reported: '처리 보고', rejected: '반려', released: '다른 사람이 수락',
}
export const WR_ASG_CLS: Record<WrAsgStatus, string> = {
  invited: 'bg-gray-100 text-gray-600', accepted: 'bg-blue-100 text-blue-700', in_progress: 'bg-indigo-100 text-indigo-700',
  done_reported: 'bg-amber-100 text-amber-700', rejected: 'bg-red-100 text-red-700', released: 'bg-gray-100 text-gray-400',
}

// 아직 끝나지 않은 상태 (담당자가 손에 들고 있는 것 + 요청자 확정 대기)
export const OPEN_STATUSES: WrStatus[] = ['requested', 'accepted', 'in_progress', 'done_reported']
// 마감 판정 대상 — 처리 보고 전까지만 "지남"으로 본다
export const DUE_TRACKED: WrStatus[] = ['requested', 'accepted', 'in_progress']
// 담당자 행 기준: 아직 손에 들고 있는 상태(할 일) / 마감 판정 대상
export const ASG_ACTIVE: WrAsgStatus[] = ['invited', 'accepted', 'in_progress', 'done_reported']
export const ASG_TRACKED: WrAsgStatus[] = ['invited', 'accepted', 'in_progress']

export interface WrPerson { id: string; name: string; team: string | null }
export interface WrAssignee {
  id: string
  employee: WrPerson | null
  status: WrAsgStatus
  accepted_at: string | null
  reported_at: string | null
  rejected_at: string | null
  reject_reason: string | null
  last_memo: string | null
  last_memo_at: string | null
}
export interface WrRow {
  id: string
  title: string
  content: string | null
  link: string | null
  due_at: string
  is_urgent: boolean
  status: WrStatus
  created_at: string
  accepted_at: string | null
  reported_at: string | null
  completed_at: string | null
  canceled_at: string | null
  rejected_at: string | null
  reject_reason: string | null
  last_memo: string | null
  last_memo_at: string | null
  is_private: boolean          // 901 — 요청자·담당자·승인권자만 조회
  assign_mode: WrMode          // 902
  requester: WrPerson | null
  assignee: WrPerson | null    // 단일·선착 수락자 (공동은 null)
  assignees: WrAssignee[]      // 902 — 담당자 전원(해제·반려 포함)
  tag_ids: string[]            // 904 — 업무 계열 태그 id (미적용 · 미분류면 빈 배열)
}

// 목록 범위 — 전체(공용) / 내가 받은 / 내가 보낸 (2026-11-02 사용자 결정: 목록 공용 전환 + 내 업무 버튼)
export type WrScope = 'all' | 'inbox' | 'outbox'
export const WR_SCOPE_LABEL: Record<WrScope, string> = { all: '전체', inbox: '내가 받은', outbox: '내가 보낸' }
export interface WrEventRow {
  id: string
  event: WrEvent
  memo: string | null
  snapshot: Record<string, unknown> | null
  created_at: string
  actor: WrPerson | null
}

const KST = 'Asia/Seoul'

// KST 날짜/시각 조각
export function kstParts(iso: string | Date) {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const f = new Intl.DateTimeFormat('ko-KR', { timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]))
  const hour = p.hour === '24' ? '00' : p.hour
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}` }
}
export const fmtDue = (iso: string) => { const k = kstParts(iso); return `${k.date.slice(5)} ${k.time}` }
export const fmtDT = (iso: string) => { const k = kstParts(iso); return `${k.date.slice(5)} ${k.time}` }
export const fmtDTFull = (iso: string) => { const k = kstParts(iso); return `${k.date} ${k.time}` }

// 마감 상태: 지남 / 오늘 / 이후 (끝난 요청·처리 보고 후에는 null)
export function dueState(row: { due_at: string; status: WrStatus }, now = new Date()): 'overdue' | 'today' | 'later' | null {
  if (!DUE_TRACKED.includes(row.status)) return null
  const due = new Date(row.due_at)
  if (due.getTime() < now.getTime()) return 'overdue'
  return kstParts(due).date === kstParts(now).date ? 'today' : 'later'
}
// 내 몫 기준 마감 상태 — 공동 요청에서 내가 이미 보고했으면 null (마감 배지는 아직 보고하지 않은 담당자에게만)
export function myDueState(row: WrRow, meId: string | null, now = new Date()): 'overdue' | 'today' | 'later' | null {
  if (!OPEN_STATUSES.includes(row.status)) return null
  const my = myShare(row, meId)
  if (my ? !ASG_TRACKED.includes(my.status) : !DUE_TRACKED.includes(row.status)) return null
  const due = new Date(row.due_at)
  if (due.getTime() < now.getTime()) return 'overdue'
  return kstParts(due).date === kstParts(now).date ? 'today' : 'later'
}

// 오늘 18:00(KST)의 datetime-local 입력값 — 마감 기본값
export function defaultDueLocal(now = new Date()): string {
  const k = kstParts(now)
  return `${k.date}T18:00`
}
// datetime-local 값(브라우저 로컬 = 직원 PC는 KST)을 ISO 로
export const localToIso = (v: string) => new Date(v).toISOString()
// ISO → datetime-local 값 (KST 기준)
export const isoToLocal = (iso: string) => { const k = kstParts(iso); return `${k.date}T${k.time}` }

// ── 담당자 다수 (902) ──
// 내 담당자 행
export const myShare = (row: Pick<WrRow, 'assignees'>, meId: string | null): WrAssignee | null =>
  meId ? row.assignees.find(a => a.employee?.id === meId) ?? null : null
// 아직 살아 있는 담당자 행 (반려·해제 제외)
export const activeAssignees = (row: Pick<WrRow, 'assignees'>) => row.assignees.filter(a => ASG_ACTIVE.includes(a.status))
// 그 사람이 이 요청의 담당자인가 (해제·반려된 사람도 '관련자'로 본다 — 비공개 조회·참고 표시)
export const isAssigneeOf = (row: Pick<WrRow, 'assignees'>, empId: string | null) => !!empId && row.assignees.some(a => a.employee?.id === empId)

// 담당자별 상태 → 요청 전체 상태 (서버 집계 규칙과 화면 설명이 같아야 하므로 여기에 둔다)
//  · 살아 있는 담당자가 없으면 반려  · 전원 보고 → 완료 확정 대기(done_reported)  · 1명이라도 진행·보고 → 진행 중  · 1명이라도 수락 → 수락  · 그 외 미확인
//  선착은 수락 시 나머지가 released 되므로 수락자 1명의 상태가 그대로 요청 상태가 된다. 단일도 같은 규칙.
export function aggregateStatus(assignees: Pick<WrAssignee, 'status'>[]): Extract<WrStatus, 'requested' | 'accepted' | 'in_progress' | 'done_reported' | 'rejected'> {
  const active = assignees.filter(a => ASG_ACTIVE.includes(a.status))
  if (!active.length) return 'rejected'
  if (active.every(a => a.status === 'done_reported')) return 'done_reported'
  if (active.some(a => a.status === 'in_progress' || a.status === 'done_reported')) return 'in_progress'
  if (active.some(a => a.status === 'accepted')) return 'accepted'
  return 'requested'
}

// 목록 '담당자' 열 요약 — 단일: 이름 / 선착: "수락자 (외 N 해제 · M 반려)" 또는 "미정 (N명 중 수락 대기)" / 공동: "팀명 N명 · 보고 k/N"
export function assigneeSummary(row: WrRow): { main: string; sub: string | null } {
  const all = row.assignees
  if (all.length <= 1) {
    const a = all[0]
    return { main: a?.employee?.name ?? row.assignee?.name ?? '-', sub: a?.employee?.team ?? null }
  }
  const active = activeAssignees(row)
  const rejected = all.filter(a => a.status === 'rejected').length
  if (row.assign_mode === 'first') {
    const acceptor = all.find(a => a.status !== 'invited' && a.status !== 'rejected' && a.status !== 'released')
    if (acceptor) {
      const released = all.filter(a => a.status === 'released').length
      const parts = [released ? `외 ${released} 해제` : null, rejected ? `${rejected} 반려` : null].filter(Boolean)
      return { main: acceptor.employee?.name ?? '-', sub: parts.length ? `(${parts.join(' · ')})` : null }
    }
    return { main: '미정', sub: `(${active.length}명 중 수락 대기${rejected ? ` · ${rejected} 반려` : ''})` }
  }
  const teams = Array.from(new Set(all.map(a => a.employee?.team ?? '')))
  const names = all.map(a => a.employee?.name ?? '').filter(Boolean)
  const main = teams.length === 1 && all.length >= 3 && teams[0] ? `${teams[0]} ${all.length}명` : all.length > 3 ? `${names.slice(0, 2).join(' · ')} 외 ${all.length - 2}` : names.join(' · ')
  const reported = active.filter(a => a.status === 'done_reported').length
  return { main, sub: OPEN_STATUSES.includes(row.status) ? `· 보고 ${reported}/${active.length}${rejected ? ` · ${rejected} 반려` : ''}` : null }
}

// 역할별 가능 조작 (서버 판정과 동일 규칙 — 화면은 노출용, 차단은 API)
//  내 몫(담당자 행)이 있고 반려·해제되지 않았으면 담당자. 선착은 수락 전(요청 requested)에만 수락 가능.
//  공동의 완료 확정은 전원 보고 전에도 요청자가 할 수 있다(2026-11-02 결정 ②). 담당자 추가는 선착 불가(결정 ③).
export function allowedActions(row: WrRow, meId: string | null) {
  const isReq = !!meId && row.requester?.id === meId
  const my = myShare(row, meId)
  const isAsg = !!my && ASG_ACTIVE.includes(my.status)
  const s = row.status
  const open = OPEN_STATUSES.includes(s)
  const mine = my?.status ?? null
  return {
    accept: isAsg && mine === 'invited' && open && (row.assign_mode !== 'first' || s === 'requested'),
    reject: isAsg && (mine === 'invited' || mine === 'accepted' || mine === 'in_progress') && open,
    memo: (isAsg || isReq) && open,
    report: isAsg && (mine === 'accepted' || mine === 'in_progress') && open,
    complete: isReq && open,
    cancel: isReq && open,
    edit: isReq && (s === 'requested' || s === 'accepted' || s === 'in_progress'),
    setTags: isReq || isAsg,   // 904 — 닫힌 요청도 가능(분류 바로잡기). 마스터 계정은 API가 추가로 허용
    addAssignee: isReq && open && row.assign_mode !== 'first',
    isReq, isAsg, mine,
  }
}
export type WrActions = ReturnType<typeof allowedActions>

export const hoursBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 36e5

// ── 업무 계열 태그 (904, 2026-11-10) ──
//  태그 마스터는 DB(work_request_tags) — 기본 8개 + 마스터 계정이 추가. 삭제 없이 숨김(active=false)만.
//  1건에 최대 WR_TAG_MAX 개. 상태 배지(칠한 사각형)와 구분되게 화면에서는 테두리 알약 + 색 점으로 그린다(components/work-requests/tag-chip).
export interface WrTag { id: string; code: string | null; label: string; color: string; keywords: string[]; sort: number; active: boolean }
export const WR_TAG_MAX = 3            // 요청 1건에 붙일 수 있는 태그 수
export const WR_TAG_ACTIVE_MAX = 12    // 사용 중(숨김 아님) 태그 수 상한 — 칩 한 줄을 넘기지 않게
export const WR_TAG_NONE = 'none'      // 목록 필터의 '미분류'
export const WR_TAG_ERP_CODE = 'erp'   // 도움말 질문하기 · 권한 요청이 자동으로 고르는 태그
// 고를 수 있는 색 — 빨강 계열은 긴급 · 마감 지남 전용이라 없다. 클래스는 정적 문자열이어야 Tailwind 가 포함한다.
export const WR_TAG_COLORS: { key: string; label: string; dot: string }[] = [
  { key: 'sky', label: '하늘', dot: 'bg-sky-600' }, { key: 'amber', label: '주황', dot: 'bg-amber-600' },
  { key: 'emerald', label: '초록', dot: 'bg-emerald-600' }, { key: 'teal', label: '청록', dot: 'bg-teal-600' },
  { key: 'indigo', label: '남색', dot: 'bg-indigo-600' }, { key: 'violet', label: '보라', dot: 'bg-violet-600' },
  { key: 'pink', label: '분홍', dot: 'bg-pink-600' }, { key: 'lime', label: '연두', dot: 'bg-lime-600' },
  { key: 'slate', label: '진회색', dot: 'bg-slate-600' }, { key: 'gray', label: '회색', dot: 'bg-gray-300' },
]
export const tagDotCls = (color: string) => WR_TAG_COLORS.find(c => c.key === color)?.dot ?? 'bg-slate-600'
// 요청의 태그를 마스터 순서대로 (숨긴 태그도 과거 요청에는 그대로 보인다)
export function tagsOf(row: Pick<WrRow, 'tag_ids'>, tags: WrTag[]): WrTag[] {
  if (!row.tag_ids?.length) return []
  const set = new Set(row.tag_ids)
  return tags.filter(t => set.has(t.id))
}
// 제목 · 내용의 키워드로 추천 (사용 중인 태그만, 시스템은 추천만 — 확정은 사용자)
export function recommendTagIds(text: string, tags: WrTag[]): string[] {
  const hay = text.toLowerCase()
  if (!hay.trim()) return []
  return tags.filter(t => t.active && t.keywords.some(k => k.trim() && hay.includes(k.trim().toLowerCase()))).map(t => t.id)
}
// 태그 id 목록 검증 — 중복 제거 · 개수. 고를 수 있는 태그(사용 중 + 이미 붙어 있던 것)만 통과
export function cleanTagIds(input: unknown, allowed: Set<string>): { ids: string[]; error: string | null } {
  const ids = Array.from(new Set((Array.isArray(input) ? input : []).filter((x): x is string => typeof x === 'string' && !!x)))
  if (!ids.length) return { ids, error: '업무 계열을 하나 이상 고르세요.' }
  if (ids.length > WR_TAG_MAX) return { ids, error: `업무 계열은 최대 ${WR_TAG_MAX}개까지 고를 수 있습니다.` }
  if (ids.some(id => !allowed.has(id))) return { ids, error: '고를 수 없는 태그가 있습니다. 화면을 새로 고친 뒤 다시 시도하세요.' }
  return { ids, error: null }
}
