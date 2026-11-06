-- =====================================================
-- 706_consultation_ship_address.sql
-- 상담일지 배송지 (사용자 확정 2026-11-06)
--
-- 주문서 배송지(513, erp_orders.ship_*)와 같은 5개 컬럼을 상담일지에도 둔다.
--  - 화면·저장 규칙은 주문서와 동일 (ShipCard 공용 부품, 지점·샘플 품목용, 선택 항목)
--  - 주문 전환 시 상담에 입력한 배송지가 주문처의 최근 배송지보다 우선 (사용자 확정 1)
--  - 선택 복사 시 배송지도 함께 복사 (사용자 확정 3)
--  - "주소확인여부"는 별개 — 명단 주소의 수령인에게 확인 전화를 했는지 표기 (개별 주문용), 유지
--  - 최근 배송지 후보(ship-addresses)는 주문 기준 그대로 — 상담 주소는 확정 전이라 넣지 않는다
-- 실행 전 데이터 변경 없음 (컬럼 추가만, 기존 행은 전부 NULL)
-- =====================================================

ALTER TABLE erp_consultations
  ADD COLUMN IF NOT EXISTS ship_name  TEXT,   -- 수령인 (존칭 포함 표기 그대로)
  ADD COLUMN IF NOT EXISTS ship_phone TEXT,   -- 수령인 연락처
  ADD COLUMN IF NOT EXISTS ship_zip   TEXT,   -- 우편번호 (5자리)
  ADD COLUMN IF NOT EXISTS ship_addr1 TEXT,   -- 주소 (우편번호 검색 결과 — 도로명)
  ADD COLUMN IF NOT EXISTS ship_addr2 TEXT;   -- 상세주소 (층 · 부서 등 직접 입력)

COMMENT ON COLUMN erp_consultations.ship_addr1 IS '상담 단계 배송지 (706) — 주문 전환 시 erp_orders.ship_*로 우선 승계';

-- ── 검증 (실행 후) ───────────────────────────────────────
-- 기대: 배송지컬럼_기대5 = 5
SELECT COUNT(*) AS 배송지컬럼_기대5
  FROM information_schema.columns
 WHERE table_name = 'erp_consultations'
   AND column_name IN ('ship_name', 'ship_phone', 'ship_zip', 'ship_addr1', 'ship_addr2');
