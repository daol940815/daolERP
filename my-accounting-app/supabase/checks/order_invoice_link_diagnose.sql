-- =====================================================
-- order_invoice_link_diagnose.sql  (결제처리 트랙 — 조회만, 아무것도 바꾸지 않음)
-- "금액이 맞는 계산서가 있는데 계산서 연결 창에 추천도 직접 연결도 안 뜬다" 원인 확인용.
-- 맨 아래 주문번호만 바꿔서 실행한다. 결과 2개(주문 1행 + 금액이 같은 매출 계산서 목록)를 알려주세요.
--
-- 연결 창에 뜨는 조건 (lib/order-invoice-match.ts)
--   주문: 그 매출처(별칭의 거래처)의 주문이고, 순매출 − 이미 연결된 계산서 금액 > 0
--   계산서: 매출 계산서이고, 거래처가 그 매출처 또는 그 매출처의 청구처여야 함. 남은 금액 > 0. 취소쌍(+A · −A) 제외
--   추천(1:1): 남은 금액이 서로 같고, 발행일이 주문일 −7일 ~ +120일
-- =====================================================

-- [1] 주문
WITH o AS (
  SELECT eo.id, eo.order_no, eo.order_date, eo.total_amount, eo.canceled_at,
         eo.vendor_id AS order_vendor_id, a.vendor_id AS alias_vendor_id
  FROM erp_orders eo
  LEFT JOIN erp_vendor_aliases a ON a.id = eo.customer_alias_id
  WHERE eo.order_no = 'D261112-025'
)
SELECT o.order_no                                   AS "주문번호",
       o.order_date                                 AS "주문일",
       o.total_amount                               AS "총금액",
       r.net_sales                                  AS "순매출",
       (SELECT COALESCE(SUM(amount), 0) FROM erp_order_invoices x WHERE x.order_id = o.id) AS "이미_연결된_계산서금액",
       va.name                                      AS "별칭의_거래처(연결창_기준)",
       vo.name                                      AS "주문의_거래처",
       (o.alias_vendor_id IS DISTINCT FROM o.order_vendor_id) AS "두_거래처가_다름",
       vb.name                                      AS "청구처",
       o.canceled_at IS NOT NULL                    AS "취소됨"
FROM o
LEFT JOIN v_erp_order_receivable r ON r.order_id = o.id
LEFT JOIN vendors va ON va.id = o.alias_vendor_id
LEFT JOIN vendors vo ON vo.id = o.order_vendor_id
LEFT JOIN vendors vb ON vb.id = va.billing_vendor_id;

-- [2] 금액이 같은 매출 계산서 (주문 순매출 또는 총금액과 합계가 같은 것, 주문일 앞뒤 120일)
WITH o AS (
  SELECT eo.id, eo.order_date, eo.total_amount, a.vendor_id AS alias_vendor_id,
         (SELECT billing_vendor_id FROM vendors v WHERE v.id = a.vendor_id) AS billing_id,
         (SELECT net_sales FROM v_erp_order_receivable r WHERE r.order_id = eo.id) AS net_sales
  FROM erp_orders eo
  LEFT JOIN erp_vendor_aliases a ON a.id = eo.customer_alias_id
  WHERE eo.order_no = 'D261112-025'
)
SELECT t.issue_date                                  AS "발행일",
       t.total_amount                                AS "합계",
       t.counterparty_name                           AS "계산서의_상호",
       v.name                                        AS "계산서에_연결된_거래처",
       CASE WHEN t.vendor_id IS NULL THEN '거래처 미연결'
            WHEN t.vendor_id = o.alias_vendor_id OR t.vendor_id = o.billing_id THEN '같은 매출처/청구처 — 창에 떠야 함'
            ELSE '다른 거래처 — 창에 안 뜸' END       AS "거래처_판정",
       (SELECT COALESCE(SUM(amount), 0) FROM erp_order_invoices x WHERE x.tax_invoice_id = t.id) AS "이미_다른주문에_연결된_금액",
       (t.issue_date - o.order_date)                 AS "발행일_빼기_주문일(일)",
       CASE WHEN (t.issue_date - o.order_date) BETWEEN -7 AND 120 THEN '추천 범위 안' ELSE '추천 범위 밖(직접 연결만)' END AS "날짜_판정",
       EXISTS (SELECT 1 FROM tax_invoices n WHERE n.direction = 'sales' AND n.vendor_id IS NOT DISTINCT FROM t.vendor_id
                 AND n.total_amount = -t.total_amount AND ABS(n.issue_date - t.issue_date) <= 90) AS "취소쌍_있음(제외됨)",
       t.approval_number                             AS "승인번호"
FROM tax_invoices t
CROSS JOIN o
LEFT JOIN vendors v ON v.id = t.vendor_id
WHERE t.direction = 'sales'
  AND t.total_amount IN (o.total_amount, o.net_sales)
  AND t.issue_date BETWEEN o.order_date - 120 AND o.order_date + 120
ORDER BY ABS(t.issue_date - o.order_date);
