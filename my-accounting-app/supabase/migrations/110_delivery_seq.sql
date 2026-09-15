-- 운송장 조회: 발주서 내 동일 내용 반복 행(각각 다른 박스)의 반복 순번
-- '' = 일반 행, '1','2',… = 같은 주문·같은 배송지로 의도적으로 여러 건 등록된 행의 순번
-- (유령 행 정리 제외, 반복 행끼리 같은 송장번호 허용 판정에 사용)
ALTER TABLE delivery_items ADD COLUMN IF NOT EXISTS seq TEXT NOT NULL DEFAULT '';
