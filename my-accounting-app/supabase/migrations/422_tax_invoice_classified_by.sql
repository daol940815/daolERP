-- =====================================================
-- 422_tax_invoice_classified_by.sql  (회계 트랙 — 스키마)
-- 계산서 계정 분류의 출처 기록 (2026-11-03)
--
-- 배경: 계산서 업로더는 이미 거래처 확정 이력 → 거래처 기본계정 → 품목 키워드 순으로 confirmed_account_id를 채웠지만
--   분개는 만들지 않았다(bulk-classify·개별 저장만 전기). 그래서 "계정은 있는데 분개가 없는" 계산서가 생겨
--   월별 손익(증빙 기준)에서 7·8월 상품매입이 0원으로 보였다. 업로더가 채운 건도 즉시 전기하도록 바꾸면서
--   어떤 건이 자동으로 분류됐는지 남겨 사람이 검토할 수 있게 한다.
-- 값: 'auto:history'(거래처 확정 이력) · 'auto:default'(거래처 기본계정) · 'auto:keyword'(품목 키워드) ·
--     'manual'(개별 저장) · 'bulk'(일괄 분류) · NULL(이전 데이터)
-- =====================================================
ALTER TABLE tax_invoices ADD COLUMN IF NOT EXISTS classified_by TEXT;
COMMENT ON COLUMN tax_invoices.classified_by IS
  '계정 분류 출처: auto:history | auto:default | auto:keyword (업로드 자동) · manual · bulk. 자동 분류 건은 화면에서 "자동" 표시 — 사람이 검토.';
CREATE INDEX IF NOT EXISTS idx_tax_invoices_classified_by ON tax_invoices(classified_by) WHERE classified_by LIKE 'auto:%';

-- 검증: 계정은 있는데 분개가 없는 계산서 수 (업로드 자동 분류의 흔적) — 분류 탭 "분개 누락 동기화" 버튼으로 전기한다
SELECT direction AS 방향, COUNT(*) AS 계정있음_분개없음, SUM(total_amount) AS 합계,
       MIN(issue_date) || ' ~ ' || MAX(issue_date) AS 작성일범위
FROM tax_invoices t
WHERE t.confirmed_account_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'tax_invoice' AND je.source_id = t.id)
  AND t.total_amount <> 0
GROUP BY direction;
