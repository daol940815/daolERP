// 휴가 3단계 결재 규칙 (204, 2026-11-04 사용자 결정 — docs/attendance-design.md "휴가 3단계 결재")
//
// - 결재 단계 1차 · 2차 · 3차, 숫자가 높을수록 상위. 직원별 단계 = employees.leave_approve_level.
// - 모든 휴가는 3단계. 3차까지 끝나야 최종 승인(attendance_leaves.status = approved).
// - 현재 단계는 저장하지 않는다 — 이력(attendance_leave_steps)이 없는 가장 낮은 단계.
// - 신청자 본인 단계 이하 자동 통과(auto). 신청자는 신청할 때 1 · 2차를 전결(skip)할 수 있다.
// - 단계 승인은 그 단계 이상 권한자(상위 결재 — 처리자 단계까지 한 번에 통과).
// - 3차 전결(proxy)은 2차 권한자만. 그 건의 2차를 승인한 사람도 가능.
// - 본인 건은 누구도 본인이 처리하지 못한다.
//
// 서버 라우트와 화면이 함께 쓰는 순수 함수만 둔다.

export type ApproveLevel = 1 | 2 | 3
export const STEPS: ApproveLevel[] = [1, 2, 3]
export type StepAction = 'approve' | 'reject' | 'auto' | 'skip' | 'proxy'

export interface LeaveStep {
  step: ApproveLevel
  action: StepAction
  actor_id: string | null
  actor_level: number | null
  note: string | null
  created_at: string
  actor_name?: string | null
}

/** 단계별 결재 권한자 (화면 표시 · 알림 대상) */
export type ApproverRoster = Record<ApproveLevel, { id: string; name: string; position: string | null }[]>
export const emptyRoster = (): ApproverRoster => ({ 1: [], 2: [], 3: [] })

export const asLevel = (v: unknown): ApproveLevel | null =>
  v === 1 || v === 2 || v === 3 ? v : null

/** 반려가 있는지 */
export const isRejected = (steps: LeaveStep[]) => steps.some(s => s.action === 'reject')

/** 현재 단계 — 이력이 없는 가장 낮은 단계. 반려됐거나 3단계가 다 찼으면 null */
export function currentStep(steps: LeaveStep[]): ApproveLevel | null {
  if (isRejected(steps)) return null
  const done = new Set(steps.map(s => s.step))
  return STEPS.find(s => !done.has(s)) ?? null
}

/** 3단계가 모두 통과했는지 (반려 없음) */
export const isComplete = (steps: LeaveStep[]) =>
  !isRejected(steps) && STEPS.every(s => steps.some(x => x.step === s))

/**
 * 이 단계의 "차례"인 결재 단계 — 그 단계 이상에서 사람이 지정된 가장 낮은 단계.
 * 예: 1차가 아무도 없으면 1차 단계의 차례는 2차 권한자에게 간다. 아무도 없으면 null.
 */
export function turnLevel(step: ApproveLevel, roster: ApproverRoster, exceptId?: string | null): ApproveLevel | null {
  return STEPS.find(l => l >= step && roster[l].some(p => p.id !== exceptId)) ?? null
}

export interface LeaveActions {
  approve: boolean     // 현재 단계 승인 (상위 결재 포함)
  proxy: boolean       // 3차 전결 (2차 권한자)
  reject: boolean
  myTurn: boolean      // 알림 · 내 차례 표시용 — 현재 단계의 차례인 단계가 내 단계일 때
}
export const NO_ACTIONS: LeaveActions = { approve: false, proxy: false, reject: false, myTurn: false }

/** 내가 이 휴가에 할 수 있는 결재 행동 */
export function leaveActions(args: {
  applicantId: string
  status: string
  steps: LeaveStep[]
  myId: string | null
  myLevel: ApproveLevel | null
  roster: ApproverRoster
}): LeaveActions {
  const { applicantId, status, steps, myId, myLevel, roster } = args
  if (status !== 'requested' || !myLevel || !myId || myId === applicantId) return NO_ACTIONS
  const s = currentStep(steps)
  if (!s) return NO_ACTIONS
  const approve = myLevel >= s
  const proxy = s === 3 && myLevel === 2
  return {
    approve, proxy, reject: approve || proxy,
    myTurn: turnLevel(s, roster, applicantId) === myLevel,
  }
}

/** 승인 시 새로 채울 단계 — 현재 단계부터 처리자 단계까지 중 이력이 없는 단계 */
export function stepsToApprove(steps: LeaveStep[], myLevel: ApproveLevel): ApproveLevel[] {
  const s = currentStep(steps)
  if (!s) return []
  const done = new Set(steps.map(x => x.step))
  return STEPS.filter(l => l >= s && l <= myLevel && !done.has(l))
}

/** 신청 시 미리 채울 단계 — 본인 단계 이하 auto, 고른 1 · 2차는 skip */
export function requestSteps(myLevel: ApproveLevel | null, skip: number[]): { step: ApproveLevel; action: 'auto' | 'skip' }[] {
  const lv = myLevel ?? 0
  const out: { step: ApproveLevel; action: 'auto' | 'skip' }[] = []
  for (const s of STEPS) {
    if (s <= lv) out.push({ step: s, action: 'auto' })
    else if (s <= 2 && skip.includes(s)) out.push({ step: s, action: 'skip' })
  }
  return out
}

// ── 표시 ──────────────────────────────────────────────
export type StepTone = 'ok' | 'up' | 'auto' | 'skip' | 'proxy' | 'rej' | 'now' | 'wait'
export const STEP_TONE_CLASS: Record<StepTone, string> = {
  ok: 'bg-green-100 text-green-800 border-transparent',
  up: 'bg-emerald-100 text-emerald-800 border-transparent',
  auto: 'bg-slate-100 text-slate-600 border-transparent',
  skip: 'bg-violet-100 text-violet-800 border-transparent',
  proxy: 'bg-violet-100 text-violet-800 border-violet-400',
  rej: 'bg-red-100 text-red-800 border-transparent',
  now: 'bg-white text-amber-700 border-amber-400 border-dashed font-semibold',
  wait: 'bg-white text-gray-300 border-gray-200 border-dashed',
}
export const STEP_ACTION_LABEL: Record<StepAction, string> = {
  approve: '승인', reject: '반려', auto: '자동 통과', skip: '신청자 전결', proxy: '전결',
}

const kstMd = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString()
  return `${d.slice(5, 7)}/${d.slice(8, 10)}`
}

/** 단계 칸 하나의 문구 · 색 */
export function stepCell(step: ApproveLevel, steps: LeaveStep[], status: string, opts?: {
  myTurn?: boolean; roster?: ApproverRoster; applicantId?: string
}): { text: string; tone: StepTone } {
  const row = steps.find(s => s.step === step)
  if (row) {
    const who = row.actor_name ?? ''
    switch (row.action) {
      case 'approve':
        return (row.actor_level ?? step) > step
          ? { text: `${who} 상위 결재`, tone: 'up' }
          : { text: `${who} · ${kstMd(row.created_at)}`, tone: 'ok' }
      case 'reject': return { text: `${who} 반려`, tone: 'rej' }
      case 'auto': return { text: '자동 통과', tone: 'auto' }
      case 'skip': return { text: '신청자 전결', tone: 'skip' }
      case 'proxy': return { text: `${who} 전결`, tone: 'proxy' }
    }
  }
  if (status === 'requested' && currentStep(steps) === step) {
    if (opts?.myTurn) return { text: '내 차례', tone: 'now' }
    const lv = opts?.roster ? turnLevel(step, opts.roster, opts.applicantId) : null
    const names = lv && opts?.roster ? opts.roster[lv].filter(p => p.id !== opts.applicantId).map(p => p.name) : []
    return { text: names.length ? `${names.join(' · ')} 대기` : '대기', tone: 'now' }
  }
  return { text: '-', tone: 'wait' }
}

/** 진행 상태 배지 문구 — '2차 진행' / '승인' / '반려' / '취소' */
export function progressLabel(status: string, steps: LeaveStep[], stepsReady: boolean): string {
  if (status === 'approved') return '승인'
  if (status === 'rejected') return '반려'
  if (status === 'canceled') return '취소'
  const s = stepsReady ? currentStep(steps) : null
  return s ? `${s}차 진행` : '승인 대기'
}
