import { can, type PermSubject } from '@/lib/permissions'

// 매입처 관리 화면이 다른 영역으로 링크를 걸어도 되는지 — 그룹 조회 권한 기준.
// 레거시 role로 판정하지 않는다 (CLAUDE.md 권한 규칙, 109).
//   accounting 계산서·통장·법인카드·ERP 주문내역 드릴다운, 매입처 구분 선택
//   tools      매입처 연결 키워드(별칭) 화면
//   collections 결제 예외 탭(매입 사이클, /api/purchase-cycle) — 수금·정산 조회 권한 (2026-09-30 사용자 확정)
//   edit        거래처 관리(customers) 수정 권한 — 등록·수정·삭제·담당 배정 버튼 노출 (차단은 미들웨어, 2026-10-01)
//   collectionsEdit 결제 예외 탭의 쓰기(확인 기록·지급 연결·자동 매칭)
export interface PurchaseHubPerms {
  accounting: boolean
  tools: boolean
  collections: boolean
  edit: boolean
  collectionsEdit: boolean
}

export const purchaseHubPerms = (me: PermSubject | null): PurchaseHubPerms => ({
  accounting: !!me && can(me, 'accounting'),
  tools: !!me && can(me, 'tools'),
  collections: !!me && can(me, 'collections'),
  edit: !!me && can(me, 'customers', 'edit'),
  collectionsEdit: !!me && can(me, 'collections', 'edit'),
})
