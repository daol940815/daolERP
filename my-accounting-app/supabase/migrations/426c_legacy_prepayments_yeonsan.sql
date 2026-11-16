-- =====================================================
-- 426c_legacy_prepayments_yeonsan.sql  (회계 트랙 — 426 후속, 1회성 데이터 적재)
-- 하나은행 연산동지점 선결제 — 사용자 확인 내역(2026-11-16)으로 반영. 426에서 잔액 −47,800이라 제외했던 지점.
-- 확인된 내역 11행:
--   2024-12-24 결제 1,450,000 / 2025-01-22 사용 1,450,000 (25설 명절 주문건)
--   2025-12-10 결제 1,500,000 / 2025-12-10 결제 8,800 / 2025-12-22 결제 514,800 / 2025-12-26 결제 47,000
--   2026-02-05 사용 1,513,000 (26설 명절 주문건) / 2026-02-05 사용 119,000 / 2026-02-05 사용 169,600 / 2026-02-05 사용 120,000 / 2026-03-16 사용 125,000
--   결제 3,520,600 − 사용 3,496,600 = 잔액 24,000. 전부 2026-10-01 이전이라 A안대로 2026-09-30 기준 이월 1줄.
-- =====================================================

-- STEP 1. 드라이런 — 별칭 · 거래처 확인 (vendor_id 가 있어야 한다)
SELECT a.id AS alias_id, a.erp_name, a.vendor_id, v.name AS 거래처명
FROM erp_vendor_aliases a LEFT JOIN vendors v ON v.id = a.vendor_id
WHERE a.alias_type = 'customer' AND a.erp_name = '하나은행 연산동지점' AND a.merged_into_alias_id IS NULL;

-- STEP 2. 이월 1줄 적재 (멱등)
INSERT INTO erp_prepayments (direction, alias_id, entry_date, entry_type, amount, memo, source_key)
SELECT 'customer', a.id, DATE '2026-09-30', 'deposit', 24000,
       '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (사용자 확인 내역 11행 합산: 결제 3,520,600 − 사용 3,496,600)',
       'legacy:open:하나은행 연산동지점'
FROM erp_vendor_aliases a
WHERE a.alias_type = 'customer' AND a.erp_name = '하나은행 연산동지점' AND a.merged_into_alias_id IS NULL
ON CONFLICT (source_key) DO NOTHING;

-- STEP 3. 검증 (기대: legacy 44행 · 잔액 17,216,450)
SELECT COUNT(*) AS legacy_행수,
       COALESCE(SUM(CASE WHEN entry_type = 'deposit' THEN amount ELSE -amount END), 0) AS 잔액
FROM erp_prepayments WHERE source_key LIKE 'legacy:%';
