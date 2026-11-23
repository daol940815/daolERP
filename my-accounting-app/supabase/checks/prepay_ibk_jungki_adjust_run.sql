-- =====================================================
-- prepay_ibk_jungki_adjust_run.sql  (결제처리 트랙 — 실행 파일, 2026-11-23 사용자 승인)
-- IBK기업은행 중기산업연구실 선결제 잔액 보정 −39,000 (이월 648,000 → 609,000). 재실행 안전.
-- 드라이런 회신: 이 별칭의 원장 3행(이월 648,000 · 10-12 사용 540,000 · 10-16 입금 420,000), 누계 528,000.
-- 11-23 주문 D261123-013 선결제 2,000,000 은 다른 별칭(주문의 매출처 별칭)에 있어 이 별칭 합계에는 안 나온다.
-- =====================================================

-- [2] 실행
INSERT INTO erp_prepayments (direction, alias_id, entry_date, entry_type, amount, source_key, memo)
SELECT 'customer', p.alias_id, DATE '2026-09-30', 'deduction', 39000, 'legacy:adj:기업은행 중기산업연구실:20260930',
       '기초 잔액 보정 −39,000 — 26.09.10 미결제 잔액 −39,000 반영(이월 648,000 → 609,000). 출처: 사용자 제공 엑셀(2026-11-23, 2025-10-13~2026-10-16 27줄)'
FROM erp_prepayments p WHERE p.source_key = 'legacy:open:기업은행 중기산연구소'
ON CONFLICT (source_key) DO NOTHING;

-- [3] 검증 — 기대: 이 별칭 잔액 489,000(엑셀 최종 잔액) / 매출처 전체(같은 거래처의 모든 별칭) 2,489,000(11-23 선결제 2,000,000 포함)
WITH al AS (SELECT DISTINCT alias_id FROM erp_prepayments WHERE source_key = 'legacy:open:기업은행 중기산연구소'),
     vd AS (SELECT a.vendor_id FROM erp_vendor_aliases a JOIN al ON al.alias_id = a.id)
SELECT
  (SELECT SUM(CASE WHEN entry_type = 'deposit' THEN amount ELSE -amount END) FROM erp_prepayments p JOIN al USING (alias_id) WHERE p.direction = 'customer') AS 이_별칭_잔액_기대489000,
  (SELECT SUM(CASE WHEN p.entry_type = 'deposit' THEN p.amount ELSE -p.amount END) FROM erp_prepayments p JOIN erp_vendor_aliases a ON a.id = p.alias_id
    WHERE p.direction = 'customer' AND a.vendor_id IN (SELECT vendor_id FROM vd)) AS 매출처_전체_잔액_기대2489000,
  (SELECT string_agg(DISTINCT v.name, ', ') FROM vendors v WHERE v.id IN (SELECT vendor_id FROM vd)) AS 거래처;
