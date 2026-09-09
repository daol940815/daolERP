-- =====================================================
-- 108_delivery_suppliers_phone.sql
-- 매입처 주소록에 연락처 항목 추가 (엑셀 업로드/다운로드 관리 지원)
-- =====================================================

ALTER TABLE delivery_suppliers ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN delivery_suppliers.phone IS '매입처 담당자 연락처 (참고용 — 메일 발송에는 사용하지 않음)';
