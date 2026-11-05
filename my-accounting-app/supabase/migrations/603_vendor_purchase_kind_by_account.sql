-- 603: 매입처 구분 일괄 분류 — 계정과목 기준 경비성 지정 (2026-11-05)
--
-- 배경: 602로 purchase_kind(partner/retail/expense)를 만들었지만 경비성은 8곳만 지정돼 있어
-- 택배·통신·렌탈·세무회계 같은 경비 거래처가 '상품 매입처'에 섞여 있었다.
-- 사용자 지시: "실제 상품을 매입하는 업체랑 경비성 업체는 아예 구분해야 한다."
--
-- 판별 규칙 (계정과목이 이미 답을 갖고 있다):
--   매입 계산서의 확정 계정이 전부 경비 계정(상품매입 5002 · 매출원가 5001 이외)이고
--   품목마스터(erp_products)에 매입처로 연결되지 않은 거래처 → expense
--   - 상품매입 계산서가 한 건이라도 있으면 상품 매입처로 둔다 (혼재 8곳 — 대상크리스탈시상품 등)
--   - 품목마스터 연결은 보호한다: (주)이음전산은 계산서는 전부 소모품비지만 보조배터리 12품목의 매입처다
--   - 미확정 계산서만 있는 곳(10곳)은 판단 근거가 없어 그대로 둔다
--   - 이미 retail/expense로 지정된 곳은 건드리지 않는다 (기확정 값 보존)
-- 2026-11-05 드라이런: 대상 54곳, 경비 계산서 합계 330,618,226원 (하나은행 창원지점 17,600 포함)
--
-- 이후 새로 생기는 경비 거래처는 매입처 상세의 '구분'에서 사람이 바꾼다(시스템은 자동 변경하지 않음).

-- ① 드라이런 — 실행 전에 이 SELECT만 먼저 돌려 54곳인지 확인
WITH acc AS (
  SELECT id, code FROM accounts
), inv AS (
  SELECT t.vendor_id,
         COUNT(*) FILTER (WHERE a.code IN ('5002','5001'))                        AS goods_cnt,
         COUNT(*) FILTER (WHERE a.code IS NOT NULL AND a.code NOT IN ('5002','5001')) AS exp_cnt,
         COALESCE(SUM(t.total_amount) FILTER (WHERE a.code IS NOT NULL AND a.code NOT IN ('5002','5001')), 0) AS exp_amt
  FROM tax_invoices t
  LEFT JOIN acc a ON a.id = t.confirmed_account_id
  WHERE t.direction = 'purchase' AND t.vendor_id IS NOT NULL
  GROUP BY t.vendor_id
), pm AS (
  SELECT DISTINCT al.vendor_id
  FROM erp_products p
  JOIN erp_vendor_aliases al ON al.id = p.purchase_alias_id
  WHERE al.vendor_id IS NOT NULL
)
SELECT v.name, i.exp_cnt, i.exp_amt
FROM inv i
JOIN vendors v ON v.id = i.vendor_id
WHERE i.goods_cnt = 0 AND i.exp_cnt > 0
  AND v.purchase_kind = 'partner'
  AND NOT EXISTS (SELECT 1 FROM pm WHERE pm.vendor_id = i.vendor_id)
ORDER BY i.exp_amt DESC;

-- ② 실행
WITH acc AS (
  SELECT id, code FROM accounts
), inv AS (
  SELECT t.vendor_id,
         COUNT(*) FILTER (WHERE a.code IN ('5002','5001'))                        AS goods_cnt,
         COUNT(*) FILTER (WHERE a.code IS NOT NULL AND a.code NOT IN ('5002','5001')) AS exp_cnt
  FROM tax_invoices t
  LEFT JOIN acc a ON a.id = t.confirmed_account_id
  WHERE t.direction = 'purchase' AND t.vendor_id IS NOT NULL
  GROUP BY t.vendor_id
), pm AS (
  SELECT DISTINCT al.vendor_id
  FROM erp_products p
  JOIN erp_vendor_aliases al ON al.id = p.purchase_alias_id
  WHERE al.vendor_id IS NOT NULL
)
UPDATE vendors v
SET purchase_kind = 'expense'
FROM inv i
WHERE v.id = i.vendor_id
  AND i.goods_cnt = 0 AND i.exp_cnt > 0
  AND v.purchase_kind = 'partner'
  AND NOT EXISTS (SELECT 1 FROM pm WHERE pm.vendor_id = i.vendor_id);

-- ③ 검증 — 실행 전 partner 2371 / retail 12 / expense 8 → 기대: partner 2317 / retail 12 / expense 62
SELECT purchase_kind, COUNT(*) FROM vendors GROUP BY purchase_kind ORDER BY 1;
