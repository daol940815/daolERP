-- 518 매입가 소수점 (주문시스템 트랙, 2026-11-16 사용자 결정 — 가안)
--
-- 업체 원가표의 매입가가 462.2원처럼 소수점인 품목이 있다. 지금은 매입가 칸이 정수(BIGINT)라
-- 원가표 업로드에서 462로 반올림되고, 발주서 금액이 업체 계산서와 수량 × 0.2원만큼 어긋났다.
-- 매입가 칸 4곳만 소수 둘째 자리까지 저장하도록 넓힌다.
--   - 기존 값은 그대로(462 → 462.00). 지워지거나 바뀌는 데이터는 없다.
--   - 매입금액 · 매입합계(purchase_total) · 발주 합계는 지금처럼 원 단위 정수 — 앱이 매입가 × 수량을 원 단위로 반올림해 저장한다.
--   - 판매가 · 수량 · 배송비 · 할인은 바꾸지 않는다.
--   - 이 칸을 쓰는 DB 함수 · 뷰는 없다(형식 변경으로 깨지는 곳 없음). 지금 운영 코드는 정수만 보내므로 먼저 실행해도 영향 없다.
-- (517은 삼진어묵 업체 양식 2단계 — 확인 매핑 저장 — 용으로 비워 둔다)

ALTER TABLE erp_products             ALTER COLUMN purchase_price TYPE NUMERIC(14,2);
ALTER TABLE erp_order_items          ALTER COLUMN purchase_price TYPE NUMERIC(14,2);
ALTER TABLE erp_consultation_items   ALTER COLUMN purchase_price TYPE NUMERIC(14,2);
ALTER TABLE erp_purchase_order_items ALTER COLUMN purchase_price TYPE NUMERIC(14,2);

-- 확인 (실행 후 4행 모두 numeric · 14 · 2)
SELECT table_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE column_name = 'purchase_price'
  AND table_name IN ('erp_products', 'erp_order_items', 'erp_consultation_items', 'erp_purchase_order_items')
ORDER BY table_name;
