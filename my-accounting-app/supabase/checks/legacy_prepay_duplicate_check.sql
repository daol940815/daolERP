-- 기존 ERP 선결제 적재(426) 뒤 신규 시스템 입력분과의 중복 조사 (2026-11-16, 여의도금융센터 5,000,000 vs 파일 3,500,000 보고)
-- 삭제는 하지 않는다 — 결과를 보고 어느 행을 지울지 사용자 승인 후 별도 SQL.

-- ① 여의도금융센터 선결제 원장 전체 (어느 행이 겹치는지 눈으로 확인)
SELECT a.erp_name, p.entry_date, p.entry_type, p.amount,
       CASE WHEN p.source_key LIKE 'legacy:%' THEN '기존 ERP 적재(426)'
            WHEN p.source_key LIKE 'pre:%'    THEN '신규 주문서 선결제 품목 자동 등록'
            WHEN p.source_key IS NULL         THEN '신규 수동 입력(또는 선결제 사용)'
            ELSE p.source_key END AS 출처,
       p.source_key, p.order_id, p.memo, p.created_at
FROM erp_prepayments p JOIN erp_vendor_aliases a ON a.id = p.alias_id
WHERE p.direction = 'customer' AND a.erp_name ILIKE '%여의도금융센터%'
ORDER BY p.entry_date, p.created_at;

-- ② 전 지점: 426 적재 행과 신규 입력 행이 같은 지점 · 같은 금액 · 같은 유형 · 날짜 ±7일이면 중복 후보
WITH legacy AS (
  SELECT p.id, p.alias_id, p.entry_date, p.entry_type, p.amount, p.memo
  FROM erp_prepayments p WHERE p.direction = 'customer' AND p.source_key LIKE 'legacy:%'
), fresh AS (
  SELECT p.id, p.alias_id, p.entry_date, p.entry_type, p.amount, p.source_key, p.order_id, p.memo, p.created_at
  FROM erp_prepayments p WHERE p.direction = 'customer' AND (p.source_key IS NULL OR p.source_key NOT LIKE 'legacy:%')
)
SELECT a.erp_name,
       l.entry_date AS 적재_일자, l.amount AS 금액, l.entry_type AS 유형, l.memo AS 적재_메모,
       f.entry_date AS 신규_일자, f.source_key AS 신규_출처, f.order_id AS 신규_주문, f.memo AS 신규_메모, f.created_at AS 신규_입력시각,
       l.id AS legacy_id, f.id AS fresh_id
FROM legacy l
JOIN fresh f ON f.alias_id = l.alias_id AND f.entry_type = l.entry_type AND f.amount = l.amount
             AND ABS(f.entry_date - l.entry_date) <= 7
JOIN erp_vendor_aliases a ON a.id = l.alias_id
ORDER BY a.erp_name, l.entry_date;

-- ③ 전 지점: 신규 시스템 입력분(426 외) 전체 — 2026-10-01 이후. 파일에도 같은 돈이 '이월'에 합산돼 있을 수 있어 금액이 달라도 봐야 한다
SELECT a.erp_name, p.entry_date, p.entry_type, p.amount,
       CASE WHEN p.source_key LIKE 'pre:%' THEN '주문서 자동 등록' WHEN p.source_key IS NULL THEN '수동/사용' ELSE p.source_key END AS 출처,
       p.order_id, p.memo, p.created_at
FROM erp_prepayments p JOIN erp_vendor_aliases a ON a.id = p.alias_id
WHERE p.direction = 'customer' AND (p.source_key IS NULL OR p.source_key NOT LIKE 'legacy:%')
ORDER BY a.erp_name, p.entry_date;

-- ④ 지점별 현재 잔액 vs 파일 잔액 (파일 = 426 적재분만의 잔액) — 차이 = 신규 입력분
SELECT a.erp_name,
       COALESCE(SUM(CASE WHEN p.entry_type = 'deposit' THEN p.amount ELSE -p.amount END), 0) AS 현재_잔액,
       COALESCE(SUM(CASE WHEN p.source_key LIKE 'legacy:%' THEN (CASE WHEN p.entry_type = 'deposit' THEN p.amount ELSE -p.amount END) ELSE 0 END), 0) AS 파일_잔액,
       COALESCE(SUM(CASE WHEN p.source_key IS NULL OR p.source_key NOT LIKE 'legacy:%' THEN (CASE WHEN p.entry_type = 'deposit' THEN p.amount ELSE -p.amount END) ELSE 0 END), 0) AS 신규_입력분
FROM erp_prepayments p JOIN erp_vendor_aliases a ON a.id = p.alias_id
WHERE p.direction = 'customer'
GROUP BY a.erp_name
HAVING COALESCE(SUM(CASE WHEN p.source_key IS NULL OR p.source_key NOT LIKE 'legacy:%' THEN (CASE WHEN p.entry_type = 'deposit' THEN p.amount ELSE -p.amount END) ELSE 0 END), 0) <> 0
ORDER BY 신규_입력분 DESC;
