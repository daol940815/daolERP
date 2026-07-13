-- =====================================================
-- 034_tax_invoice_issued_date.sql
-- 세금계산서 발급일자 — 작성일자(issue_date)와 다를 수 있음
-- (예: 월합계세금계산서를 익월 10일에 발급하는 경우 작성일자는 전월, 발급일자는 익월)
-- 매입처 정산 화면에서 ERP 매입금액(거래 발생월) vs 계산서 발급월을 비교해
-- 이월 발급 건을 표시하는 데 사용한다.
-- =====================================================

ALTER TABLE tax_invoices ADD COLUMN IF NOT EXISTS issued_date DATE;

COMMENT ON COLUMN tax_invoices.issued_date
  IS '홈택스 발급일자 (작성일자 issue_date와 다를 수 있음 — 이월 발급 판단용)';
