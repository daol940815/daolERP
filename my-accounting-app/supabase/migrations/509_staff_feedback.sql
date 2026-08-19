-- =====================================================
-- 509_staff_feedback.sql
-- 실무자 보완사항 1차 (김주연 요청 문서 2026-08-18, Sheet1(2) 최종본 — 사용자 확정)
--
--  1) 품절 관리: 품목 관리 화면에서 수동 품절 처리 (사용자 확정 — 재고 연동 아님)
--  2) 상담 품목별 상태·기타사항: 상담정보 레벨 → 품목 레벨로 이동
--     (기존 erp_consultations.product_status·option_note 컬럼은 원본 보존 차원에서
--      유지 — 새 입력은 품목 레벨에 저장)
--  3) 결제·발송 정보 확장: 이메일·팩스·사업자등록번호·대표자명 (계산서 발행용)
--  4) 요아럽 발주서 판매가 기재 (사용자 확정): 매입처 플래그로 처리 —
--     발주서 생성 시 매입가 대신 판매가로 스냅샷
-- =====================================================

-- ── 1) 품목 품절 플래그 ───────────────────────────────
ALTER TABLE erp_products
  ADD COLUMN IF NOT EXISTS is_soldout BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN erp_products.is_soldout IS
  '품절 — 품목 관리 화면에서 수동 처리. 상담·주문 입력 검색에 품절 표시, 상담 품목 상태 자동표기에 사용.';

-- ── 2) 상담 품목별 상태·기타사항 ──────────────────────
ALTER TABLE erp_consultation_items
  ADD COLUMN IF NOT EXISTS status      TEXT,   -- 품절·단가변경 등 (자동표기+수정 가능)
  ADD COLUMN IF NOT EXISTS option_note TEXT;   -- 색상·옵션 등 기타사항 (품목별)
COMMENT ON COLUMN erp_consultation_items.status IS
  '품목 상태 — 품절(마스터 품절 플래그)·단가변경(입력가와 원가표 대조) 자동표기 + 자유 수정.';

-- ── 3) 상담 결제·발송 정보 확장 (계산서 발행용) ───────
ALTER TABLE erp_consultations
  ADD COLUMN IF NOT EXISTS invoice_email TEXT,   -- 계산서 수신 이메일
  ADD COLUMN IF NOT EXISTS fax           TEXT,
  ADD COLUMN IF NOT EXISTS biz_number    TEXT,   -- 사업자등록번호
  ADD COLUMN IF NOT EXISTS ceo_name      TEXT;   -- 대표자명

-- ── 4) 발주서 판매가 기재 매입처 ──────────────────────
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS po_use_sale_price BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN vendors.po_use_sale_price IS
  '발주서 금액을 매입가 대신 판매가로 기재하는 매입처 (요아럽 — 사용자 확정 2026-08-19).';

-- 요아럽 지정 (purchase 별칭 경유 — 표기 변형 포함)
UPDATE vendors v SET po_use_sale_price = true
FROM erp_vendor_aliases a
WHERE a.vendor_id = v.id AND a.alias_type = 'purchase' AND a.erp_name = '요아럽';

-- ── 검증 ──────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM erp_products WHERE is_soldout) AS 품절_품목수_초기0,
  (SELECT count(*) FROM vendors WHERE po_use_sale_price) AS 판매가발주_매입처수_기대1,
  (SELECT string_agg(name, ', ') FROM vendors WHERE po_use_sale_price) AS 판매가발주_매입처명;
