-- =====================================================
-- 512_cost_table_roundtrip.sql
-- 원가표 완전 왕복 (B안 — 2026-10-01 사용자 확정)
--
-- 실무 원가표 엑셀(29열)을 그대로 업로드·다운로드하기 위해 품목 마스터에
-- 지금까지 무시하던 컬럼들의 저장처를 만든다. 원가표의 원본 관리가 수기
-- 파일에서 ERP로 넘어오는 기반.
--  - status_note: 상태 자유 메모 원문 ('품절(입고미정)', '블랙 품절' 등).
--    판정 규칙(사용자 확정): '품절'로 시작 → is_soldout / '단종'·'사용중지'로
--    시작 → is_active=false / 그 외는 사용. 원문은 그대로 보존·출력.
--  - 재고품여부·재고·보조 택배비는 현재 원가표에서 자리 채움 값이지만
--    왕복 보존을 위해 그대로 저장한다.
--  - 매입처 담당자·연락처·이메일은 품목이 아니라 매입처 정보 — vendors
--    (contact_name·contact_phone·email)에서 채우고, 업로드 시 값이 있으면
--    갱신한다 (빈 값은 보존). 별도 컬럼 추가 없음.
--
-- 실행: Supabase SQL 편집기 (사용자 직접 실행)
-- =====================================================

ALTER TABLE erp_products
  ADD COLUMN IF NOT EXISTS catalog_name       TEXT,     -- 상품명(카탈로그 표기용)
  ADD COLUMN IF NOT EXISTS consumer_price     BIGINT,   -- 소비자가
  ADD COLUMN IF NOT EXISTS composition        TEXT,     -- 구성 (카탈로그 설명)
  ADD COLUMN IF NOT EXISTS catalog_text       TEXT,     -- 카탈로그 (표기 문구)
  ADD COLUMN IF NOT EXISTS stock_flag         TEXT,     -- 재고품여부 (원가표 표기 그대로)
  ADD COLUMN IF NOT EXISTS stock_qty          BIGINT,   -- 재고
  ADD COLUMN IF NOT EXISTS shipping_fee_extra BIGINT,   -- 원가표 보조 택배비 열 (왕복 보존)
  ADD COLUMN IF NOT EXISTS status_note        TEXT;     -- 상태 메모 원문

COMMENT ON COLUMN erp_products.catalog_name   IS '카탈로그 표기용 상품명 (원가표 왕복 — 512)';
COMMENT ON COLUMN erp_products.consumer_price IS '소비자가 (원가표 왕복)';
COMMENT ON COLUMN erp_products.composition    IS '구성 — 카탈로그 설명 (원가표 왕복)';
COMMENT ON COLUMN erp_products.catalog_text   IS '카탈로그 표기 문구 (원가표 왕복)';
COMMENT ON COLUMN erp_products.stock_flag     IS '재고품여부 표기 (원가표 왕복 보존)';
COMMENT ON COLUMN erp_products.stock_qty      IS '재고 (원가표 왕복 보존)';
COMMENT ON COLUMN erp_products.shipping_fee_extra IS '원가표 보조 택배비 열 (왕복 보존)';
COMMENT ON COLUMN erp_products.status_note    IS
  '상태 메모 원문 — 품절/단종/사용중지 시작이면 플래그 파생, 그 외 표기는 사용 판정 + 원문 표시 (2026-10-01 확정)';

-- ── 검증 (실행 후 결과 보고용) ─────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'erp_products'
      AND column_name IN ('catalog_name', 'consumer_price', 'composition', 'catalog_text',
                          'stock_flag', 'stock_qty', 'shipping_fee_extra', 'status_note')) AS 품목컬럼_기대8;
