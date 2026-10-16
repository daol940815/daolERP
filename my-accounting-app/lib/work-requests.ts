// 업무 요청 — 공용 타입·라벨·판정 (docs/work-request-track.md, 900)
// 상태: requested → accepted → in_progress → done_reported → completed / canceled / rejected

export type WrStatus = 'requested' | 'accepted' | 'in_progress' | 'done_reported' | 'completed' | 'canceled' | 'rejected'
export type WrEvent = 'created' | 'accepted' | 'rejected' | 'memo' | 'reported' | 'completed' | 'canceled' | 'edited'

export const WR_STATUS_LABEL: Record<WrStatus, string> = {
  requested: '미확인', accepted: '수락', in_progress: '진행 중', done_reported: '처리 보고',
  completed: '완료', canceled: '취소', rejected: '반려',
}
export const WR_STATUS_CLS: Record<WrStatus, string> = {
  requested: 'bg-gray-100 text-gray-600', accepted: 'bg-blue-100 text-blue-700', in_progress: 'bg-indigo-100 text-indigo-700',
  done_reported: 'bg-amber-100 text-amber-700', completed: 'bg-green-100 text-green-700',
  canceled: 'bg-gray-100 text-gray-400 line-through', rejected: 'bg-red-100 text-red-700',
}
export const WR_EVENT_LABEL: Record<WrEvent, string> = {
  created: '요청 생성', accepted: '수락', rejected: '반려', memo: '진행 메모', reported: '처리 완료 보고',
  completed: '완료 확정', canceled: '요청 취소', edited: '요청 수정',
}

// 아직 끝나지 않은 상태 (담당자가 손에 들고 있는 것 + 요청자 확정 대기)
export const OPEN_STATUSES: WrStatus[] = ['requested', 'accepted', 'in_progress', 'done_reported']
// 마감 판정 대상 — 처리 보고 전까지만 "지남"으로 본다
export const DUE_TRACKED: WrStatus[] = ['requested', 'accepted', 'in_progress']

export interface WrPerson { id: string; name: string; team: string | null }
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
  requester: WrPerson | null
  assignee: WrPerson | null
}
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

// 오늘 18:00(KST)의 datetime-local 입력값 — 마감 기본값
export function defaultDueLocal(now = new Date()): string {
  const k = kstParts(now)
  return `${k.date}T18:00`
}
// datetime-local 값(브라우저 로컬 = 직원 PC는 KST)을 ISO 로
export const localToIso = (v: string) => new Date(v).toISOString()
// ISO → datetime-local 값 (KST 기준)
export const isoToLocal = (iso: string) => { const k = kstParts(iso); return `${k.date}T${k.time}` }

// 역할별 가능 조작 (서버 판정과 동일 규칙 — 화면은 노출용, 차단은 API)
export function allowedActions(row: { status: WrStatus; requester: WrPerson | null; assignee: WrPerson | null }, meId: string | null) {
  const isReq = !!meId && row.requester?.id === meId
  const isAsg = !!meId && row.assignee?.id === meId
  const s = row.status
  const open = OPEN_STATUSES.includes(s)
  return {
    accept: isAsg && s === 'requested',
    reject: isAsg && (s === 'requested' || s === 'accepted' || s === 'in_progress'),
    memo: (isAsg || isReq) && open,
    report: isAsg && (s === 'accepted' || s === 'in_progress'),
    complete: isReq && open,
    cancel: isReq && open,
    edit: isReq && (s === 'requested' || s === 'accepted' || s === 'in_progress'),
    isReq, isAsg,
  }
}

export const hoursBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 36e5
