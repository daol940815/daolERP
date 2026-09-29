// 직원별 영역 권한 — 109_employee_permissions.sql 의 데이터 모델과 판정 규칙 (docs/ui-reorg-track.md)
//
// 그룹(권한 단위) 8개에 없음/조회/수정. 영역 4개는 그룹의 묶음이며, 영역 접근 = 그 영역의
// 그룹 중 하나라도 조회 이상. 마스터는 전 영역 수정. 109 미적용(permissions 비어 있음)이면
// 레거시 role로 폴백해 기존 동작을 유지한다.

export type PermLevel = 'none' | 'view' | 'edit'
export const GROUP_KEYS = ['customers', 'orders', 'collections', 'accounting', 'closing', 'tools', 'hr', 'mgmt'] as const
export type GroupKey = typeof GROUP_KEYS[number]
export type AreaKey = 'sales' | 'finance' | 'hr' | 'mgmt'
export type Permissions = Partial<Record<GroupKey, PermLevel>>

export const GROUP_LABELS: Record<GroupKey, string> = {
  customers: '고객 · 영업',
  orders: '주문 · 발주',
  collections: '수금 · 정산 작업',
  accounting: '회계 · 재무',
  closing: '결산 · 세무 자료',
  tools: '점검 · 정리 도구',
  hr: '인사 · 총무',
  mgmt: '경영 현황',
}

export interface AreaDef {
  key: AreaKey
  label: string
  groups: GroupKey[]
  home: string          // 영역 진입 시 첫 화면
  viewOnly?: boolean    // 경영 현황 — 수정 개념 없음
}

export const AREAS: AreaDef[] = [
  { key: 'sales',   label: '영업 · 주문', groups: ['customers', 'orders', 'collections'], home: '/me' },
  { key: 'finance', label: '회계 · 재무', groups: ['accounting', 'closing', 'tools'],     home: '/transactions' },
  { key: 'hr',      label: '인사 · 총무', groups: ['hr'],                                  home: '/employees' },
  { key: 'mgmt',    label: '경영 현황',   groups: ['mgmt'],                                home: '/', viewOnly: true },
]
export const areaByKey = (key: AreaKey) => AREAS.find(a => a.key === key)!

// 권한 판정에 필요한 최소 사용자 정보 (CurrentUser가 이 형태를 만족한다)
export interface PermSubject {
  role: 'sales' | 'manager' | 'admin'
  isMaster: boolean
  permissions: Permissions
  canApprove: boolean
  expired?: boolean     // 아르바이트 근무 종료일 경과 — 전 영역 차단
}

const RANK: Record<PermLevel, number> = { none: 0, view: 1, edit: 2 }

// 109 미적용(permissions 빈 객체) 환경의 폴백 — 기존 role 동작과 같게
function legacyLevel(role: PermSubject['role'], group: GroupKey): PermLevel {
  if (role === 'admin') return group === 'mgmt' ? 'view' : 'edit'
  if (role === 'manager') return (['customers', 'orders', 'collections'] as GroupKey[]).includes(group) ? 'edit' : 'none'
  return (['customers', 'orders'] as GroupKey[]).includes(group) ? 'edit' : 'none'
}

export function levelOf(me: PermSubject, group: GroupKey): PermLevel {
  if (me.expired) return 'none'
  if (me.isMaster) return group === 'mgmt' ? 'view' : 'edit'
  const hasData = Object.keys(me.permissions ?? {}).length > 0
  const raw = hasData ? (me.permissions[group] ?? 'none') : legacyLevel(me.role, group)
  if (group === 'mgmt' && raw === 'edit') return 'view'
  return raw
}

export const can = (me: PermSubject, group: GroupKey, level: PermLevel = 'view') =>
  RANK[levelOf(me, group)] >= RANK[level]

export const canArea = (me: PermSubject, area: AreaKey, level: PermLevel = 'view') =>
  areaByKey(area).groups.some(g => can(me, g, level))

export const areasFor = (me: PermSubject): AreaDef[] => AREAS.filter(a => canArea(me, a.key))

export const canApprove = (me: PermSubject) => !me.expired && (me.isMaster || me.canApprove)

// 폼·API에서 쓰는 한 줄 판정 — 그룹 수정 권한 또는 승인권
export const isEditor = (me: PermSubject, group: GroupKey) => can(me, group, 'edit')

// ── 레거시 role 판정 호환 (1차 재조정) ─────────────────────────
// 기존 코드의 `me.role === 'sales'`(일반 직원) / `me.role !== 'admin'`(관리자 전용) 판정을
// 새 권한으로 흡수한다. 승인권·마스터가 있으면 관리자급으로 본다.
export const isManagerLike = (me: PermSubject) => !me.expired && (me.isMaster || me.canApprove || me.role !== 'sales')
export const isHrAdmin = (me: PermSubject) => !me.expired && (me.isMaster || can(me, 'hr', 'edit') || me.role === 'admin')
