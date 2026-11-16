-- =====================================================
-- 426b_legacy_prepayments_missing_two.sql  (회계 트랙 — 426 후속, 1회성 데이터 적재)  ※ 2026-11-16 사용자 확인으로 개정
-- 426에서 매출처 별칭이 없어 빠진 2지점 4행 재적재
--   · 기업은행 중기산연구소 = 신규 ERP의 "기업은행 중기산업연구실" (사용자 확인) → 그 이름으로 3행
--       이월 648,000 · 10-12 사용 540,000 · 10-16 결제 420,000  (잔액 528,000)
--   · 우리은행 아크로비스타금융센터 = 신규 ERP에 없는 지점 → **매출처 관리 › 매출처 등록**(업체 '우리은행' / 지점 '아크로비스타금융센터')으로
--       먼저 등록한 뒤 이 파일을 실행 (화면 등록이 업체 연결 · 코드 · 담당 등 기본값을 채운다 — SQL로 거래처를 만들지 않는다) → 이월 4,000 1행
-- source_key 는 426과 같은 멱등키(legacy:open:…, legacy:2, legacy:3). 재실행 안전.
-- =====================================================

-- ── STEP 1. 드라이런: 두 지점의 거래처 · 별칭 상태 (vendor_id 가 둘 다 있어야 STEP 2로) ──
WITH src(alias_name) AS (VALUES ('기업은행 중기산업연구실'), ('우리은행 아크로비스타금융센터'))
SELECT s.alias_name,
       v.id AS vendor_id, v.name AS 거래처명, v.status,
       a.id AS 별칭_id, a.vendor_id AS 별칭_거래처
FROM src s
LEFT JOIN vendors v ON v.name = s.alias_name AND v.status = 'active'
LEFT JOIN erp_vendor_aliases a ON a.alias_type = 'customer' AND a.erp_name = s.alias_name AND a.merged_into_alias_id IS NULL
ORDER BY s.alias_name;

-- ── STEP 2. 별칭 보강 — 거래처는 있는데 customer 별칭이 없으면 만든다 (있으면 거래처 연결만 채움) ──
INSERT INTO erp_vendor_aliases (alias_type, erp_name, vendor_id)
SELECT 'customer', s.alias_name, v.id
FROM (VALUES ('기업은행 중기산업연구실'), ('우리은행 아크로비스타금융센터')) AS s(alias_name)
JOIN vendors v ON v.name = s.alias_name AND v.status = 'active'
ON CONFLICT (alias_type, erp_name) DO UPDATE SET vendor_id = COALESCE(erp_vendor_aliases.vendor_id, EXCLUDED.vendor_id);

-- ── STEP 3. 4행 적재 ──
INSERT INTO erp_prepayments (direction, alias_id, entry_date, entry_type, amount, memo, source_key)
SELECT 'customer', a.id, v.entry_date, v.entry_type, v.amount, v.memo, v.source_key
FROM (VALUES
  ('기업은행 중기산업연구실',      DATE '2026-09-30', 'deposit',   648000, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 1행 합산) [기존 ERP 표기: 기업은행 중기산연구소]', 'legacy:open:기업은행 중기산연구소'),
  ('기업은행 중기산업연구실',      DATE '2026-10-12', 'deduction', 540000, '성화수 윤조 마스크 10개 × 54,000 (출처: 사용자 제공 이미지(2026-11-16)) [기존 ERP 표기: 기업은행 중기산연구소]', 'legacy:2'),
  ('기업은행 중기산업연구실',      DATE '2026-10-16', 'deposit',   420000, '카드 선결제 (출처: 사용자 제공 이미지(2026-11-16)) [기존 ERP 표기: 기업은행 중기산연구소]', 'legacy:3'),
  ('우리은행 아크로비스타금융센터', DATE '2026-09-30', 'deposit',     4000, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 1행 합산)', 'legacy:open:우리은행 아크로비스타금융센터')
) AS v(alias_name, entry_date, entry_type, amount, memo, source_key)
JOIN erp_vendor_aliases a ON a.alias_type = 'customer' AND a.erp_name = v.alias_name AND a.merged_into_alias_id IS NULL
ON CONFLICT (source_key) DO NOTHING;

-- ── STEP 4. 검증 (기대: 43행 · 잔액 17,192,450 · 빠진 행 없음) ──
SELECT COUNT(*) AS legacy_행수,
       COALESCE(SUM(CASE WHEN entry_type = 'deposit' THEN amount ELSE -amount END), 0) AS 잔액
FROM erp_prepayments WHERE source_key LIKE 'legacy:%';

SELECT a.erp_name, COALESCE(SUM(CASE WHEN p.entry_type = 'deposit' THEN p.amount ELSE -p.amount END), 0) AS 잔액, COUNT(*) AS 행
FROM erp_prepayments p JOIN erp_vendor_aliases a ON a.id = p.alias_id
WHERE p.source_key IN ('legacy:open:기업은행 중기산연구소', 'legacy:2', 'legacy:3', 'legacy:open:우리은행 아크로비스타금융센터')
GROUP BY a.erp_name;
