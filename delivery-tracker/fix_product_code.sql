-- =====================================================
-- 품번·주문일 날짜 변환 오염 복구 (Supabase SQL Editor에서 실행)
--
-- 원인: Google Sheets가 '269-04-02' 같은 품번 텍스트를 날짜(서기 269년)로
--       자동 변환해 저장했고, Apps Script가 JSON으로 내보내면서
--       '0269-04-01T15:32:08.000Z' 형태(과거 한국 표준시 오프셋 +8:27:52)가 됨.
--       /db/migrate가 그 값을 그대로 복사함.
-- 복구: Asia/Seoul 기준 날짜로 되돌리고 연도 앞의 0 제거 → '269-04-02'
-- 재실행 안전: 이미 복구된 값은 패턴에 걸리지 않아 그대로 둠.
-- =====================================================

-- ① 미리보기: 오염된 행 확인
SELECT local_id, product_name, product_code, order_date
FROM delivery_items
WHERE product_code ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
   OR order_date   ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}';

-- ② 품번 복구
UPDATE delivery_items
SET product_code = ltrim(
  to_char(product_code::timestamptz AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'), '0')
WHERE product_code ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}';

-- ③ 주문일 정리 (ISO 날짜시간 → YYYY-MM-DD)
UPDATE delivery_items
SET order_date =
  to_char(order_date::timestamptz AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
WHERE order_date ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}';

-- ④ 확인: 남은 오염 행이 0건이어야 함
SELECT count(*) AS remaining
FROM delivery_items
WHERE product_code ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
   OR order_date   ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}';
