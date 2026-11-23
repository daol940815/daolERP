-- =====================================================
-- prepay_ibk_jungki_adjust.sql  (결제처리 트랙 — 2026-11-23, 사용자 승인 후 실행)
-- IBK기업은행 중기산업연구실 선결제 기초 잔액 보정: 648,000 → 609,000 (−39,000)
--   근거: 사용자 제공 엑셀(2025-10-13~2026-10-16, 27줄, 누계 검산 일치) — 26.09.10 잔액 −39,000 뒤 26.09.14 카드 선결제 648,000 → 09-30 잔액 609,000.
--   11-16 적재(426b)의 이월 648,000 은 기존 ERP 파일 "상세 1행 합산"이라 앞선 −39,000 이 빠졌다.
--   기존 행은 고치지 않고 보정 1행(차감 39,000, 2026-09-30)을 더한다. 재실행 안전(source_key 멱등).
-- [1] 드라이런 → 결과 확인 → [2] 실행(주석 풀기) → [3] 검증
-- =====================================================

-- [1] 드라이런 — 이 별칭의 원장과 잔액 (보정 전 / 보정 후)
WITH al AS (SELECT DISTINCT p.alias_id FROM erp_prepayments p WHERE p.source_key = 'legacy:open:기업은행 중기산연구소')
SELECT p.entry_date, p.entry_type, p.amount, p.source_key, p.memo,
       SUM(CASE WHEN p.entry_type = 'deposit' THEN p.amount ELSE -p.amount END) OVER (ORDER BY p.entry_date, p.created_at) AS 누계
FROM erp_prepayments p JOIN al ON al.alias_id = p.alias_id
WHERE p.direction = 'customer'
UNION ALL
SELECT DATE '2026-09-30', 'deduction (보정 — 추가될 행)', 39000, 'legacy:adj:기업은행 중기산업연구실:20260930', '기초 잔액 보정', NULL
ORDER BY 1, 4;

-- [2] 실행
-- INSERT INTO erp_prepayments (direction, alias_id, entry_date, entry_type, amount, source_key, memo)
-- SELECT 'customer', p.alias_id, DATE '2026-09-30', 'deduction', 39000, 'legacy:adj:기업은행 중기산업연구실:20260930',
--        '기초 잔액 보정 −39,000 — 26.09.10 미결제 잔액 −39,000 반영(이월 648,000 → 609,000). 출처: 사용자 제공 엑셀(2026-11-23, 2025-10-13~2026-10-16 27줄)'
-- FROM erp_prepayments p WHERE p.source_key = 'legacy:open:기업은행 중기산연구소'
-- ON CONFLICT (source_key) DO NOTHING;

-- [3] 검증 — 기대: 10-16까지 잔액 489,000 (엑셀 최종 잔액과 같음) · 지금 잔액 2,489,000 (11-23 선결제 2,000,000 포함)
-- WITH al AS (SELECT DISTINCT alias_id FROM erp_prepayments WHERE source_key = 'legacy:open:기업은행 중기산연구소')
-- SELECT SUM(CASE WHEN entry_date <= '2026-10-16' THEN (CASE WHEN entry_type = 'deposit' THEN amount ELSE -amount END) ELSE 0 END) AS 잔액_1016_기대489000,
--        SUM(CASE WHEN entry_type = 'deposit' THEN amount ELSE -amount END) AS 지금_잔액
-- FROM erp_prepayments p JOIN al USING (alias_id) WHERE p.direction = 'customer';
