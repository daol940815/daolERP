// 메뉴 목록 — 단일 원천 (docs/ui-reorg-track.md, 재배치안 v2)
//
// 사이드바 4영역·업무 선택 화면·페이지 접근 가드가 모두 이 목록을 읽는다. 항목을 옮기거나
// 이름을 바꿀 때는 이 파일만 고친다. 화면 코드(경로)는 옮기지 않았다 — 메뉴 위치·이름만.
// 노출 규칙: 그룹의 권한 키(GroupKey)에 조회 이상 / 'my'는 전원 / 'team'은 승인권.

import { AREAS, type AreaKey, type GroupKey } from '@/lib/permissions'

export type MenuGroupKey = GroupKey | 'my' | 'team'

export interface MenuItem {
  label: string
  href: string
  // 활성 판정용 접두(기본 href). 상세 경로(/orders/123 등)도 이 항목으로 잡힌다.
  prefix?: string
  // 사이드바 하위 동적 목록: 계좌별·카드별 바로가기
  dynamic?: 'banks' | 'cards'
  // 고정 하위 항목 (세금계산서 4종 등)
  children?: { label: string; href: string; exact?: boolean }[]
  wip?: boolean           // 준비 중 (비활성)
  exact?: boolean         // 활성 판정을 정확 일치로
  // 그룹과 다른 권한이 필요한 항목 (예: 내 업무 그룹의 '내 고객'은 고객 권한 필요)
  requires?: GroupKey
}

// 그룹 소속 영역. 'all' = 모든 영역 사이드바에 나오는 공통 그룹(내 업무 — 2026-10-01: 회계·재무·인사·총무만 보는
// 직원도 출근 체크·근태·휴가·업무일지를 써야 하므로 영업·주문에서 떼어 전 영역 공통으로)
export type MenuArea = AreaKey | 'all'

export interface MenuGroup {
  key: MenuGroupKey
  area: MenuArea
  label: string
  items: MenuItem[]
  foldDefault?: boolean   // 기본 접힘
}

export const MENU: MenuGroup[] = [
  // ── 영업 · 주문 ─────────────────────────────────────
  { key: 'my', area: 'all', label: '내 업무', items: [
    { label: '내 대시보드', href: '/me', exact: true },
    { label: '내 고객', href: '/sales-hub?mine=1', prefix: '/sales-hub?mine', requires: 'customers' },
    { label: '영업일지', href: '/me/journal' },
    { label: '업무일지', href: '/me/worklog' },
    { label: '근태 · 휴가', href: '/hr/attendance' },
  ]},
  { key: 'customers', area: 'sales', label: '거래처 관리', items: [
    // 고객 관리(거래처 담당자, /sales-hub/contacts)는 매출처 관리 안의 [지점 기준|고객 기준] 토글로 진입
    // (2026-09-29 사용자 확정 (b) — 사이드바 항목 없음)
    { label: '매출처 관리', href: '/sales-hub' },
    { label: '매입처 관리', href: '/orders/purchase-hub' },
  ]},
  { key: 'orders', area: 'sales', label: '주문 · 발주', items: [
    { label: '상담일지', href: '/orders/consultations' },
    { label: '주문 현황', href: '/orders', exact: true },
    { label: '신규 주문', href: '/orders/new' },
    { label: '발주서', href: '/orders/purchase' },
    { label: '배송 관리', href: '/orders/delivery', wip: true },
    { label: '품목 관리', href: '/orders/products' },
    { label: '샘플 재고', href: '/orders/sample-stock' },
  ]},
  { key: 'collections', area: 'sales', label: '수금 · 정산 작업', items: [
    { label: '수금 대상', href: '/reports/erp-receivables' },
    { label: '입금 매칭', href: '/erp-matching' },
    { label: '계산서 발행 대상', href: '/sales-cycle' },
    // 매입 결제 예외(/purchase-cycle)는 매입처 관리의 '결제 예외' 탭으로 통합 (2026-09-30 통합 7)
  ]},
  { key: 'team', area: 'sales', label: '팀 관리', items: [
    { label: '주문 수정 승인', href: '/orders/approvals' },
    { label: '휴가 승인', href: '/hr/approvals' },
    { label: '팀 업무 현황', href: '/me/team-worklog' },
  ]},

  // ── 회계 · 재무 ─────────────────────────────────────
  { key: 'accounting', area: 'finance', label: '회계 · 재무', items: [
    { label: '파일 업로드', href: '/upload' },
    { label: '통장 내역', href: '/transactions', dynamic: 'banks' },   // 거래 내역 / 분류 작업 탭 (2026-09-30 통합 5)
    { label: '카드 내역', href: '/cards', dynamic: 'cards' },   // 매출 / 법인카드 탭 (2026-09-30 통합)
    // 계산서 목록(매출·매입 × 과세·면세 칩) / 매입 분류 탭 — 하위 5개 항목은 삭제 (2026-09-30 통합 6)
    { label: '계산서 내역', href: '/tax-invoices' },
    { label: '현금영수증', href: '/cash-receipts' },
    { label: 'ERP 주문내역', href: '/erp-orders' },
    { label: '미수금 관리', href: '/reports/receivables-aging' },
    { label: '미지급금 관리', href: '/reports/payables-aging' },
    { label: '매출처 관리', href: '/sales-hub' },
    { label: '매입처 관리', href: '/purchase-hub' },
  ]},
  { key: 'closing', area: 'finance', label: '결산 · 세무 자료', foldDefault: true, items: [
    { label: '월별 손익현황', href: '/reports/monthly-pl' },
    { label: '예상 부가세', href: '/reports/vat-estimate' },
    { label: '분개 자료', href: '/journal' },
    { label: '계정별 원장', href: '/ledger' },
    { label: '거래처 원장', href: '/vendor-ledger' },
    { label: '기초잔액', href: '/opening-balances' },   // 계정과목 / 거래처 탭 (2026-09-30 통합)
    { label: '계정과목', href: '/accounts' },
  ]},
  { key: 'tools', area: 'finance', label: '점검 · 정리 도구', foldDefault: true, items: [
    { label: '매출처 연결 키워드', href: '/erp-aliases?type=customer', prefix: '/erp-aliases' },
    { label: '매입처 연결 키워드', href: '/erp-aliases?type=purchase', prefix: '/erp-aliases?type=purchase' },
    { label: '거래처 중복 정리', href: '/vendor-dedup' },
    { label: '거래처 정산 대조', href: '/reports/vendor-reconciliation' },
    { label: '이중계상 검사', href: '/reports/double-count' },
    { label: 'ERP VIP 선결제', href: '/reports/erp-special' },
  ]},

  // ── 인사 · 총무 ─────────────────────────────────────
  { key: 'hr', area: 'hr', label: '인사 · 총무', items: [
    { label: '직원 · 계정 · 권한', href: '/employees' },
    { label: '근태 현황', href: '/hr/admin' },
    { label: '휴가 승인', href: '/hr/approvals' },
  ]},

  // ── 경영 현황 ───────────────────────────────────────
  { key: 'mgmt', area: 'mgmt', label: '경영 현황', items: [
    { label: '대시보드', href: '/', exact: true },
    { label: '자금 · 계좌', href: '/reports/cash' },   // 계좌 통합현황 / 자금일보 탭 (2026-09-30 통합)
    { label: '대출 관리', href: '/loans' },
    { label: '거래처별 매출 분석', href: '/reports/vendor-sales' },
    { label: '거래처별 수익성 분석', href: '/reports/vendor-profitability' },
    { label: '매출처 관리', href: '/sales-hub' },
    { label: '매입처 관리', href: '/purchase-hub' },
  ]},
]

// 경로 → 이 경로를 담고 있는 (영역, 그룹) 목록. 상세 경로는 접두 일치로 잡는다.
// 메뉴에 없는 경로(드릴다운 /source/…, 상세 /orders/[id] 등)는 접두가 가장 긴 항목을 따른다.
// 'all' 그룹의 경로는 네 영역 모두에 속한다 — 어느 영역에서 들어가도 그 영역에 머문다.
const expandArea = (area: MenuArea): AreaKey[] => area === 'all' ? AREAS.map(a => a.key) : [area]

export function ownersOf(pathname: string): { area: AreaKey; group: MenuGroupKey }[] {
  const path = pathname.split('?')[0]
  const hits: { area: AreaKey; group: MenuGroupKey; len: number }[] = []
  for (const g of MENU) {
    for (const it of g.items) {
      const base = (it.prefix ?? it.href).split('?')[0]
      const match = it.exact ? path === base : (path === base || path.startsWith(base.endsWith('/') ? base : base + '/'))
      const group: MenuGroupKey = it.requires ?? g.key
      if (match) for (const area of expandArea(g.area)) hits.push({ area, group, len: base.length })
      for (const c of it.children ?? []) {
        const cb = c.href.split('?')[0]
        if (path === cb) for (const area of expandArea(g.area)) hits.push({ area, group, len: cb.length })
      }
    }
  }
  if (hits.length === 0) return []
  const max = Math.max(...hits.map(h => h.len))
  return hits.filter(h => h.len === max).map(({ area, group }) => ({ area, group }))
}

// 메뉴에 없지만 존재하는 경로의 소속 (드릴다운·상세·API 없는 화면)
export const EXTRA_PATH_OWNERS: { prefix: string; area: MenuArea; group: MenuGroupKey }[] = [
  { prefix: '/source/', area: 'finance', group: 'accounting' },
  { prefix: '/erp-aliases/pending', area: 'finance', group: 'tools' },
  { prefix: '/card-sales/customer-links', area: 'finance', group: 'accounting' },
  // 통합 전 옛 주소(리다이렉트 스텁) — 소속을 유지해 영역이 튀지 않게 한다
  { prefix: '/card-sales', area: 'finance', group: 'accounting' },
  { prefix: '/card-expenses', area: 'finance', group: 'accounting' },
  { prefix: '/vendor-opening-balances', area: 'finance', group: 'closing' },
  { prefix: '/bank-classify', area: 'finance', group: 'accounting' },
  { prefix: '/purchase-cycle', area: 'sales', group: 'collections' },   // 옛 주소 스텁 + 거래처 진행상태 상세
  { prefix: '/reports/cash-position', area: 'mgmt', group: 'mgmt' },
  { prefix: '/reports/daily-cash', area: 'mgmt', group: 'mgmt' },
  { prefix: '/customers', area: 'finance', group: 'accounting' },
  { prefix: '/vendors', area: 'finance', group: 'accounting' },
  { prefix: '/hr', area: 'all', group: 'my' },
  { prefix: '/me', area: 'all', group: 'my' },
  { prefix: '/orders', area: 'sales', group: 'orders' },
]

export function ownersOfPath(pathname: string) {
  const own = ownersOf(pathname)
  if (own.length) return own
  const path = pathname.split('?')[0]
  const extra = EXTRA_PATH_OWNERS
    .filter(e => path === e.prefix.replace(/\/$/, '') || path.startsWith(e.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)
  return extra.length ? expandArea(extra[0].area).map(area => ({ area, group: extra[0].group })) : []
}

// API 경로 → 권한 그룹 (미들웨어 검사용). 접두가 긴 것이 우선. 없는 경로는 로그인만으로 허용.
// 수준은 미들웨어가 정한다: GET/HEAD = 조회, 그 외 = 수정.
export const API_OWNERS: { prefix: string; group: MenuGroupKey }[] = [
  // 전원
  { prefix: '/api/me', group: 'my' },
  { prefix: '/api/attendance', group: 'my' },
  // 팀 관리
  { prefix: '/api/team', group: 'team' },
  // 고객 · 영업
  { prefix: '/api/vendor-hub', group: 'customers' },
  { prefix: '/api/contact-manager', group: 'customers' },
  { prefix: '/api/vendor-master', group: 'customers' },
  { prefix: '/api/vendor-links', group: 'customers' },
  // 주문 · 발주
  { prefix: '/api/orders-portal', group: 'orders' },
  { prefix: '/api/sample-stock', group: 'orders' },
  { prefix: '/api/erp-items', group: 'orders' },
  // 수금 · 정산 작업
  { prefix: '/api/erp-matching', group: 'collections' },
  { prefix: '/api/sales-cycle', group: 'collections' },
  { prefix: '/api/purchase-cycle', group: 'collections' },
  { prefix: '/api/purchase-hub', group: 'customers' },   // 매입처 관리가 거래처 관리 그룹으로 이동(2026-09-29)
  { prefix: '/api/erp-prepayments', group: 'collections' },
  { prefix: '/api/erp-settlements', group: 'collections' },
  { prefix: '/api/reports/erp-receivables', group: 'collections' },
  { prefix: '/api/reports/erp-payables', group: 'collections' },
  // 회계 · 재무
  { prefix: '/api/bank-accounts', group: 'accounting' },
  { prefix: '/api/card-accounts', group: 'accounting' },
  { prefix: '/api/transactions', group: 'accounting' },
  { prefix: '/api/upload', group: 'accounting' },
  { prefix: '/api/card-sales', group: 'accounting' },
  { prefix: '/api/card-expenses', group: 'accounting' },
  { prefix: '/api/cash-receipts', group: 'accounting' },
  { prefix: '/api/tax-invoices', group: 'accounting' },
  { prefix: '/api/erp-orders', group: 'accounting' },
  { prefix: '/api/source', group: 'accounting' },
  { prefix: '/api/vendors', group: 'accounting' },
  { prefix: '/api/loans', group: 'accounting' },
  { prefix: '/api/reports/receivables-aging', group: 'accounting' },
  { prefix: '/api/reports/payables-aging', group: 'accounting' },
  // 결산 · 세무 자료
  { prefix: '/api/journal', group: 'closing' },
  { prefix: '/api/ledger', group: 'closing' },
  { prefix: '/api/accounts', group: 'closing' },
  { prefix: '/api/opening-balances', group: 'closing' },
  { prefix: '/api/vendor-opening-balances', group: 'closing' },
  { prefix: '/api/vendor-ledger-entries', group: 'closing' },
  { prefix: '/api/reports/monthly-pl', group: 'closing' },
  { prefix: '/api/reports/vat-estimate', group: 'closing' },
  // 점검 · 정리 도구
  { prefix: '/api/erp-aliases', group: 'tools' },
  { prefix: '/api/reports/double-count', group: 'tools' },
  { prefix: '/api/reports/vendor-reconciliation', group: 'tools' },
  { prefix: '/api/reports/erp-special', group: 'tools' },
  // 인사 · 총무
  { prefix: '/api/employees', group: 'hr' },
  // 경영 현황 (조회)
  { prefix: '/api/reports/cash-position', group: 'mgmt' },
  { prefix: '/api/reports/daily-cash', group: 'mgmt' },
  { prefix: '/api/reports/vendor-sales', group: 'mgmt' },
  { prefix: '/api/reports/vendor-profitability', group: 'mgmt' },
]

export function apiOwnerOf(pathname: string): MenuGroupKey | null {
  const hit = API_OWNERS
    .filter(o => pathname === o.prefix || pathname.startsWith(o.prefix + '/') || pathname.startsWith(o.prefix + '?'))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]
  return hit?.group ?? null
}
