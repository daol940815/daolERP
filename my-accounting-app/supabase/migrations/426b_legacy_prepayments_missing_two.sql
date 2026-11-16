-- =====================================================
-- 426b_legacy_prepayments_missing_two.sql  (회계 트랙 — 426 후속, 1회성 데이터 적재)
-- 426에서 매출처 별칭이 없어 빠진 2지점 4행 재적재 (2026-11-16)
--   기업은행 중기산연구소: 이월 648,000 · 10-12 사용 540,000 · 10-16 결제 420,000  (잔액 528,000)
--   우리은행 아크로비스타금융센터: 이월 4,000
-- 전제: 두 지점이 매출처 관리에 매출처로 등록돼 있어야 한다(없으면 매출처 관리 › 매출처 등록에서
--   업체 '기업은행' / 지점 '중기산연구소', 업체 '우리은행' / 지점 '아크로비스타금융센터' 로 먼저 등록).
-- 하는 일: ① 그 매출처 이름("은행명 지점명")과 같은 거래처를 찾아 customer 별칭을 만든다(이미 있으면 그대로)
--          ② 4행을 넣는다(source_key 멱등 — 426과 같은 키).
-- =====================================================

-- ── STEP 1. 드라이런: 거래처 존재 확인 (두 줄 다 vendor_id 가 있어야 한다) ──
WITH src(alias_name) AS (VALUES ('기업은행 중기산연구소'), ('우리은행 아크로비스타금융센터'))
SELECT s.alias_name, v.id AS vendor_id, v.name, v.status, v.is_active,
       (SELECT id FROM erp_vendor_aliases a WHERE a.alias_type = 'customer' AND a.erp_name = s.alias_name AND a.merged_into_alias_id IS NULL) AS 기존_별칭
FROM src s
LEFT JOIN vendors v ON v.name = s.alias_name AND v.status = 'active'
ORDER BY s.alias_name;

-- ── STEP 2. 별칭 생성 (거래처가 있는 지점만) ──
INSERT INTO erp_vendor_aliases (alias_type, erp_name, vendor_id)
SELECT 'customer', s.alias_name, v.id
FROM (VALUES ('기업은행 중기산연구소'), ('우리은행 아크로비스타금융센터')) AS s(alias_name)
JOIN vendors v ON v.name = s.alias_name AND v.status = 'active'
ON CONFLICT (alias_type, erp_name) DO UPDATE SET vendor_id = COALESCE(erp_vendor_aliases.vendor_id, EXCLUDED.vendor_id);

-- ── STEP 3. 4행 적재 (426 STEP 2와 같은 값 · 같은 멱등키) ──
INSERT INTO erp_prepayments (direction, alias_id, entry_date, entry_type, amount, memo, source_key)
SELECT 'customer', a.id, v.entry_date, v.entry_type, v.amount, v.memo, v.source_key
FROM (VALUES
  ('기업은행 중기산연구소',        DATE '2026-09-30', 'deposit',   648000, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 1행 합산)', 'legacy:open:기업은행 중기산연구소'),
  ('기업은행 중기산연구소',        DATE '2026-10-12', 'deduction', 540000, '성화수 윤조 마스크 10개 × 54,000 (출처: 사용자 제공 이미지(2026-11-16))', 'legacy:2'),
  ('기업은행 중기산연구소',        DATE '2026-10-16', 'deposit',   420000, '카드 선결제 (출처: 사용자 제공 이미지(2026-11-16))', 'legacy:3'),
  ('우리은행 아크로비스타금융센터', DATE '2026-09-30', 'deposit',     4000, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 1행 합산)', 'legacy:open:우리은행 아크로비스타금융센터')
) AS v(alias_name, entry_date, entry_type, amount, memo, source_key)
JOIN erp_vendor_aliases a ON a.alias_type = 'customer' AND a.erp_name = v.alias_name AND a.merged_into_alias_id IS NULL
ON CONFLICT (source_key) DO NOTHING;

-- ── STEP 4. 검증 (기대: 43행 · 잔액 17,192,450 · 빠진 행 0) ──
SELECT COUNT(*) AS legacy_행수,
       COALESCE(SUM(CASE WHEN entry_type = 'deposit' THEN amount ELSE -amount END), 0) AS 잔액
FROM erp_prepayments WHERE source_key LIKE 'legacy:%';

SELECT v.alias_name, COUNT(*) AS 빠진_행
FROM (VALUES ('기업은행 중기산연구소'), ('기업은행 중기산연구소'), ('기업은행 중기산연구소'), ('우리은행 아크로비스타금융센터')) AS v(alias_name)
LEFT JOIN erp_vendor_aliases a ON a.alias_type = 'customer' AND a.erp_name = v.alias_name AND a.merged_into_alias_id IS NULL
WHERE a.id IS NULL GROUP BY v.alias_name;
