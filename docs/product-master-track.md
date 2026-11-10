# 품목관리 트랙 인수인계 (2026-11-10 신설)

품목 마스터(`erp_products`)와 품목 관리 화면을 맡는 트랙. 2026-11-10 주문시스템 트랙(500번대)에서 분리.
이전 이력(결정 배경 · 원가표 왕복 상세 · 서식 재현 대조)은 `docs/order-system-track.md`의 품목 관련 절에 보존되어 있다.

- 마이그레이션 번호: **1000번대** (새 트랙 = 다음 100번대). 기존 품목 마이그레이션(500~504 · 509 · 512 · 703 · 800)은 원래 번호 유지.
  4자리 파일명(`1000_...sql`)은 사전순 정렬에서 `100_` 근처에 끼지만 실행은 사용자가 수동으로 하므로 문제 없음.
- 실행은 사용자가 Supabase SQL 편집기에서 직접. 파일만 만들어 전달.

## 1. 범위

관리(이 트랙 소유):
- 화면 `/orders/products` — `my-accounting-app/app/(orders)/orders/products/page.tsx` (클라이언트 컴포넌트 1개)
- API 3개 (`API_OWNERS`의 `/api/orders-portal` → 영업·주문 그룹)
  - `app/api/orders-portal/products/route.ts` — GET 전체 목록 / POST create · update · deactivate · reactivate · soldout · restock
  - `app/api/orders-portal/products/import/route.ts` — 원가표 업로드(검사 → 확인 팝업 → 반영)
  - `app/api/orders-portal/products/export/route.ts` — 원가표 29열 + 서식 재현 다운로드
- `erp_products` 스키마 확장, 품목 도움말 항목(`lib/help-registry.ts` `/orders/products`)
- 원가표 업로드 · 다운로드 규칙, 품목 플래그(품절 · 사용 중지 · 부가상품 · 비용 품목 · 샘플 재고 대상)

범위 밖(참조만 — 고치려면 범위를 먼저 사용자에게 말할 것):
- 주문 입력 `app/(orders)/orders/order-form.tsx`, 상담일지 `app/(orders)/orders/consultations/consult-form.tsx`
  — 둘 다 `GET /api/orders-portal/products` 응답 `{ products: [...] }`를 품번 검색 원천으로 그대로 씀.
  **응답 모양을 바꾸면 두 화면이 깨진다** (필드 추가는 안전, 제거 · 이름 변경 금지).
- FK: `erp_order_items.product_id`(500), `erp_consultation_items.product_id`(506), 배송명단(707), 샘플 재고(800)
- 발주서 `lib/po-assemble.ts`(is_addon · is_shipping), 주문 상세 `app/api/orders-portal/orders/[id]/route.ts`(is_shipping),
  샘플 재고 `app/api/sample-stock/route.ts`(is_sample_stock), 603 매입처 구분 판정(품목에 연결된 매입처 = 상품 매입)

## 2. 스키마 현황 (`erp_products`, 전부 적용 완료)

| 번호 | 내용 |
|---|---|
| 500 | 생성 — 품번 `item_code` NULL 허용 · 있으면 유일(부분 유니크 인덱스), `purchase_alias_id` |
| 501 | 카톤단위 · 카톤택배비 |
| 502 | 개별판매가 |
| 503 | 카톤외택배비 · 목차(category) · 옵션명 |
| 504 | 부가상품 `is_addon` |
| 509 | 품절 `is_soldout` |
| 512 | 원가표 왕복 컬럼(catalog_name · consumer_price · composition · catalog_text · stock_flag · stock_qty · shipping_fee_extra · status_note) |
| 703 | 비용 품목 `is_shipping` (700번대 트랙에서 추가) |
| 800 | 샘플 재고 대상 `is_sample_stock` (800번대 트랙에서 추가) |

## 3. 업무 규칙 (확정 — 바꾸지 말 것)

- 주문 · 상담은 입력 당시 가격을 보존. 품목 가격 변경은 새 주문부터, 과거 소급 없음.
- 품목 마스터는 이 화면 한 곳에서만 등록 · 수정, 다른 화면은 참조만.
- 옵션 두 종류: 변형 옵션(1P/2P, 6구)은 품번별 별도 품목 / 부가상품(포장 · 부자재)은 `is_addon`.
  원가표 업로드 시 품번 `NN-01` 대역(정규식 `^\d{2}-01(-|$)`, VIP · 선결제 제외)은 부가상품 자동 표시.
- 비용 품목(배송비 · 퀵비 · 설치비)은 사람이 체크. 이름 키워드 자동 추천은 오판만 나와 폐지(2026-11-05) — 되살리지 말 것.
- 원가표 상태 칸: 원문 보존 + **시작 일치** 판정('품절' → 품절 / '단종' · '사용중지' → 사용중지 / 그 외 → 사용).
- 업로드 시 매입처 담당자 · 연락처1 · 이메일1은 `vendors`에 반영(값 있을 때만, 빈 값 보존 — 매입처 허브와 두 입구, 나중 수정이 이김).
  매입처명은 `ensureAlias(admin, 'purchase', 이름)`로 별칭 자동 연결.
- 원가표 업로드 · 다운로드는 실무 원가표와 **완전 왕복**이 기준. 열 · 서식을 바꾸면 원본과 대조할 것.
- 화면 정렬(2026-11-09)은 화면에서만, 저장 안 함. **엑셀 다운로드는 품번순 고정**(상품 그룹 세로 병합이 품번순 전제).
- 변경 권한: `can(me, 'orders', 'edit')` (영업·주문 그룹 수정). role로 판정하지 않는다.

## 4. 미결 항목

1. ~~수정 버튼 노출 제어~~ — 2026-11-10 반영(아래 작업 기록).
2. **원가표 수기 강조색** — 원본의 손으로 칠한 녹색 · 노랑 · 빨강 셀, 회색 글씨는 데이터가 아니라 다운로드에 재현 안 됨.
   의미 있는 색이면 데이터(플래그)로 올릴지 사용자 회신 대기.
3. ~~도움말 문구와 실제 화면 불일치~~ — 2026-11-10 반영.

## 5. 작업 기록

- 2026-11-10 트랙 신설: CLAUDE.md 번호 대역 등록(1000번대), 이 문서 생성, 주문시스템 트랙 문서에 이관 안내.
  인수 점검 결과 요청문과 현재 main 일치(화면 555줄 · API 3개 · 마이그레이션 목록 · 참조처), 차이는 미결 3번(도움말 문구)만.
- 2026-11-10 수정 버튼 노출 제어(미결 1 · 3, 사용자 지시 "1번부터 진행"):
  - `GET /api/orders-portal/products` 응답에 `can_edit: can(me, 'orders', 'edit')` 추가(필드 추가만 — 주문 입력 · 상담일지는 `products`만 읽어 영향 없음).
  - 화면: 수정 권한이 없으면 "상품 엑셀 업로드" · "+ 품목 등록" 버튼, 행 오른쪽 조작 칸(수정 · 품절/품절해제 · 중지/재사용),
    표 아래 업로드 안내문을 숨김. 응답 전에는 숨김(깜빡임 방지). 조회 · 엑셀 다운로드 · 매입처 클릭 필터는 전원 유지.
  - 차단은 기존대로 API(`can()` 403) · 미들웨어. page.tsx · route.ts 머리 주석의 "manager/admin" 정정.
  - 도움말: 순서 문구를 실제 버튼 이름으로 정정, FAQ "버튼이 안 보여요" 보강, changes 한 줄.
  - 검증: `npm run build` 통과. 실제 화면 확인(권한 있는 / 없는 계정)은 배포 후 사용자 확인 필요 — 이 세션은 운영 로그인 불가.
