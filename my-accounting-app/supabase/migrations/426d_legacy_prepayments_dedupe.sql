-- 426d: 기존 ERP 선결제 적재분과 신규 ERP 직접 입력분의 중복 제거 (2026-11-16)
-- 조사 ④ 결과: 파일과 겹치는 지점 3곳의 신규 입력분이 426 적재 11월 입금과 금액이 정확히 같다.
--   여의도금융센터 11-03 1,500,000 (legacy:73) / 서린지점 11-04 3,234,300 (legacy:33a) / 투자상품전략부 11-10 3,000,000 (legacy:112)
--   서린지점은 사용자 제공 원장으로 재확인: 11.04 선결제 3,234,300 1건 → 잔액 820,100 = 파일 잔액. 신규 입력분 3,234,300은 같은 입금.
-- 방침: 신규 ERP에 사용자가 직접 넣은 행(주문 연결·메모가 붙을 수 있음)을 남기고, 다시 만들 수 있는 426 적재 행을 지운다.
-- 안전장치: 같은 지점 · deposit · 같은 금액 · ±7일의 신규 행이 실제로 있을 때만 지운다(없으면 0행).
-- 사용자 승인 후 실행. STEP 1(드라이런)만 먼저 돌려 3행이 나오는지 보고 STEP 2·3 실행.

-- STEP 1. 드라이런: 지울 적재 행과 짝이 되는 신규 행
SELECT a.erp_name, l.source_key, l.entry_date AS 적재_일자, l.amount,
       f.entry_date AS 신규_일자, f.source_key AS 신규_출처, f.order_id AS 신규_주문, f.memo AS 신규_메모
FROM erp_prepayments l
JOIN erp_vendor_aliases a ON a.id = l.alias_id
JOIN erp_prepayments f ON f.alias_id = l.alias_id AND f.direction = 'customer' AND f.entry_type = 'deposit'
     AND f.amount = l.amount AND ABS(f.entry_date - l.entry_date) <= 7
     AND (f.source_key IS NULL OR f.source_key NOT LIKE 'legacy:%')
WHERE l.source_key IN ('legacy:73', 'legacy:33a', 'legacy:112')
ORDER BY a.erp_name;

-- STEP 2. 삭제 (짝이 있는 적재 행만)
DELETE FROM erp_prepayments l
WHERE l.source_key IN ('legacy:73', 'legacy:33a', 'legacy:112')
  AND EXISTS (
    SELECT 1 FROM erp_prepayments f
    WHERE f.alias_id = l.alias_id AND f.direction = 'customer' AND f.entry_type = 'deposit'
      AND f.amount = l.amount AND ABS(f.entry_date - l.entry_date) <= 7
      AND (f.source_key IS NULL OR f.source_key NOT LIKE 'legacy:%'))
RETURNING source_key, entry_date, amount;

-- STEP 3. 검증: 세 지점 잔액 = 파일 잔액 (여의도 3,500,000 / 서린 820,100 / 투자상품전략부 3,017,800), 적재 행 41 · 9,482,150 (17,216,450 − 7,734,300)
SELECT a.erp_name,
       SUM(CASE WHEN p.entry_type = 'deposit' THEN p.amount ELSE -p.amount END) AS 현재_잔액
FROM erp_prepayments p JOIN erp_vendor_aliases a ON a.id = p.alias_id
WHERE p.direction = 'customer' AND a.erp_name IN ('하나은행 여의도금융센터', '하나은행 서린지점', '하나은행 투자상품전략부')
GROUP BY a.erp_name ORDER BY a.erp_name;

SELECT COUNT(*) AS legacy_행수,
       SUM(CASE WHEN entry_type = 'deposit' THEN amount ELSE -amount END) AS 잔액
FROM erp_prepayments WHERE direction = 'customer' AND source_key LIKE 'legacy:%';
