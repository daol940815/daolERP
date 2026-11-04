-- =====================================================
-- 513_order_ship_address.sql  (주문시스템 트랙 — 배송지 1단계)
-- 2026-11-04 사용자 확정 (시안 docs/mockups/배송지_주문서_시안.html, "가안으로 진행")
--
-- 주문서에 배송지(지점 · 샘플 배송 품목용 단일 배송지)를 저장한다.
--  - 주소는 주문에 저장 — 매출처 마스터(vendors)는 건드리지 않는다
--  - 자동 채움: 같은 주문처(vendor_id)의 가장 최근 배송지 (조회용 인덱스)
--  - 선택 항목: 비어 있어도 저장 가능, 화면에서 "배송지 미입력" 경고만
--  - 개별 배송(수령인 다수)은 2단계(4페이즈 배송현황)에서 명단 테이블로 별도 설계
-- 실행 전 데이터 변경 없음 (컬럼 추가만, 기존 행은 전부 NULL)
-- =====================================================

ALTER TABLE erp_orders
  ADD COLUMN IF NOT EXISTS ship_name  TEXT,   -- 수령인 (존칭 포함 표기 그대로 — 예: 권오병 부장님)
  ADD COLUMN IF NOT EXISTS ship_phone TEXT,   -- 수령인 연락처
  ADD COLUMN IF NOT EXISTS ship_zip   TEXT,   -- 우편번호 (5자리)
  ADD COLUMN IF NOT EXISTS ship_addr1 TEXT,   -- 주소 (우편번호 검색 결과 — 도로명)
  ADD COLUMN IF NOT EXISTS ship_addr2 TEXT;   -- 상세주소 (층 · 부서 등 직접 입력)

-- 최근 배송지 조회: vendor_id별 최근 주문 중 주소가 있는 것
CREATE INDEX IF NOT EXISTS idx_erp_orders_vendor_ship
  ON erp_orders (vendor_id, created_at DESC)
  WHERE ship_addr1 IS NOT NULL;

-- ── 검증 (실행 후) ───────────────────────────────────────
-- 기대: 배송지컬럼_기대5 = 5 / 인덱스_기대1 = 1
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'erp_orders'
      AND column_name IN ('ship_name', 'ship_phone', 'ship_zip', 'ship_addr1', 'ship_addr2')) AS 배송지컬럼_기대5,
  (SELECT COUNT(*) FROM pg_indexes
    WHERE tablename = 'erp_orders' AND indexname = 'idx_erp_orders_vendor_ship') AS 인덱스_기대1;
