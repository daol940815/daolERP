# 매입처 허브 트랙 인수인계 (2026-08 기준)

매출처 허브의 미러 — 매입처 단위로 발주·매입·지급을 통합 조회/관리하는 화면.
마이그레이션 번호는 **600번대**. 매출처 허브(총괄 세션, 100번대)를 본보기로 삼되
**코드는 복제하지 말고 새 파일로**(lib/purchase-hub.ts, app/(dashboard)/purchase-hub 등).

## 목적

- 매입처별 통합 조회: 매입 규모 · 미결제(미지급) 잔액 · 지급 이력 · 발주 이력
- "관리 안 되는 매입처" 사전 파악 (미지급 장기화, 정산 불일치)
- 사이드바 '정리 도구'에 흩어진 매입 기능(매입 사이클·미지급 Aging·매입처 관리)의 허브화

## 데이터 소스 (전부 기존 원본 — 새 원본 없음)

- 매입처 마스터: `vendors` (type='vendor'/'both') + 별칭 `erp_vendor_aliases` (alias_type='purchase')
- 매입 세금계산서: `tax_invoices` (direction='purchase') — 미지급 발생(+)
- 통장 출금: `transactions` + 매칭 — 지급(-). 기존 매입 사이클/거래처 원장 로직 참조
- 법인카드: `card_expenses` (매입처 연결분)
- ERP 주문 품목의 매입처: `erp_order_items.purchase_vendor_name` (+ purchase_alias_id) —
  발주 관점 매입 규모. 주문시스템 3단계(발주서)가 열리면 발주 이력의 원천이 됨
- 기존 리포트 로직 재사용: 미지급 Aging(`reports/payables-aging`), 거래처 정산 대조

## 선행 확정 사항 (총괄·회계 트랙에서 결정됨)

- **미결제금 기초원장**: 사용자가 관리하는 매입처별 결제현황 엑셀을 기준일 기초잔액으로
  적재하고, 기준일 이후는 매입 계산서(+)/출금 매칭(-) 원본 증분으로만 변동.
  기준일 이전 원본은 잔액 계산에서 제외(이중계상 방지).
  **적재 작업은 이 트랙이 수행** (승인 → 드라이런 → 실행 → 검증 보고 루틴).
  → 결제현황 엑셀·기준일은 사용자에게 요청할 것. docs/accounting-track.md 방침 참조.
- 매입처 기초잔액 스키마: 기존 vendor_opening_balances가 매출(수금) 중심인지 확인 후,
  매입측 확장 또는 별도 테이블을 600번대로 설계.

## 참조 패턴 (매출처 허브에서 검증된 것)

- 집계: `lib/vendor-hub.ts` — fetchAllRows/fetchAllParallel/fetchByIds(청크),
  JSONB 단일 응답 RPC(`102_hub_summary_json.sql`)로 1000행 절단·왕복 문제 해결
- 화면: 목록(KPI 카드=필터 연동 + 통합 검색 + 칩 필터) + 상세(기간칩·탭·타임라인·드릴다운)
- 상태는 데이터에서 자동 판정 (수동 상태 입력 금지)
- 담당 관리: 매입처 담당자도 contacts/contact_assignments(인물 마스터) 재사용 가능

## 주의

- 사이드바 `components/layout/Sidebar.tsx`는 여러 트랙이 수정하는 공유 파일 —
  main 병합 전 원격 main pull/rebase 필수. 메뉴 위치는 경영관리 그룹(매출처 허브 옆).
- 매출처 허브 코드(lib/vendor-hub.ts 등)를 수정하지 말 것 — 필요한 로직은 새 파일로.
- ERP 품목 매입처 표기도 자유 텍스트라 별칭(purchase) 미연결분이 있을 수 있음 —
  미연결 큐 패턴(거래처 담당자 관리의 미확인 큐 참조) 재사용 권장.
