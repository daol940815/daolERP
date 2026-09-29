// 영역 판정 서버 헬퍼 — 레이아웃(AreaShell)·업무 선택 화면이 공유한다.
import type { CurrentUser } from '@/lib/user-role'
import { AREAS, areaByKey, areasFor, can, canApprove, type AreaKey } from '@/lib/permissions'
import { MENU, ownersOfPath, type MenuGroup, type MenuGroupKey } from '@/lib/menu-registry'

export const AREA_COOKIE = 'daol-area'

// 그룹 접근 가능 여부: 내 업무는 전원, 팀 관리는 승인권, 그 외는 그룹 권한(조회 이상)
export function groupAccessible(me: CurrentUser, group: MenuGroupKey): boolean {
  if (me.expired) return false
  if (group === 'my') return true
  if (group === 'team') return canApprove(me)
  return can(me, group)
}

// 경로 접근 가능 여부 — 메뉴에 없는 경로는 로그인만으로 허용(드릴다운·상세는 접두로 소속을 찾는다)
export function pathAccessible(me: CurrentUser, pathname: string): boolean {
  const owners = ownersOfPath(pathname)
  if (owners.length === 0) return !me.expired
  return owners.some(o => groupAccessible(me, o.group))
}

// 사용자의 첫 화면: 접근 가능한 첫 영역의 홈
export function homeFor(me: CurrentUser): string {
  const areas = areasFor(me)
  return areas[0]?.home ?? '/me'
}

// 현재 경로가 속한 영역 고르기: 쿠키로 기억한 영역이 이 경로를 담고 있으면 그것, 아니면
// 이 경로를 담은 첫 접근 가능 영역, 그것도 없으면 사용자의 첫 영역
export function pickArea(me: CurrentUser, pathname: string, cookieArea: string | undefined): AreaKey {
  const owners = ownersOfPath(pathname).filter(o => groupAccessible(me, o.group))
  const areaKeys = owners.map(o => o.area)
  if (cookieArea && areaKeys.includes(cookieArea as AreaKey)) return cookieArea as AreaKey
  if (areaKeys.length) return areaKeys[0]
  if (cookieArea && AREAS.some(a => a.key === cookieArea) && areasFor(me).some(a => a.key === cookieArea)) return cookieArea as AreaKey
  return areasFor(me)[0]?.key ?? 'sales'
}

// 영역의 사이드바 그룹 (권한으로 거른 것)
export function groupsFor(me: CurrentUser, area: AreaKey): MenuGroup[] {
  return MENU.filter(g => g.area === area && groupAccessible(me, g.key))
}

export const areaLabel = (area: AreaKey) => areaByKey(area).label
