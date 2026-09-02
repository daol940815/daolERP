-- =====================================================
-- 105_delivery_items.sql
-- 배송조회(운송장 조회 프로그램) 데이터 저장 테이블
--  - Google Sheets(Apps Script) 저장소를 Supabase로 이전
--  - 접근 경로: 프로그램 → Cloudflare Workers(/db/*) → 이 테이블
--    (Workers가 secret key로 접근. 브라우저에서 직접 접근하지 않음)
--  - 날짜류(shipped_at/added_at/updated_at 등)는 기존 프로그램의
--    표기 형식을 그대로 보존하기 위해 text로 저장 (무손실 이전)
--  - 추후 ERP 주문(erp_orders 등)과 연동 예정
-- =====================================================

CREATE TABLE IF NOT EXISTS delivery_items (
  local_id     TEXT PRIMARY KEY,          -- 프로그램이 부여하는 영구 행 ID (송장 없는 건 포함 모든 행의 고유키)
  carrier      TEXT NOT NULL DEFAULT 'lotte',  -- 택배사 코드(cj/lotte/hanjin/epost/logen/lottedept …) 또는 이름
  num          TEXT NOT NULL DEFAULT '',  -- 운송장번호 (미등록이면 빈값)
  order_date   TEXT NOT NULL DEFAULT '',  -- 주문일 (YYYY-MM-DD)
  bank_name    TEXT NOT NULL DEFAULT '',  -- 은행명
  branch_name  TEXT NOT NULL DEFAULT '',  -- 지점명
  manager      TEXT NOT NULL DEFAULT '',  -- 고객명
  product_code TEXT NOT NULL DEFAULT '',  -- 품번
  product_name TEXT NOT NULL DEFAULT '',  -- 품명
  ship_type    TEXT NOT NULL DEFAULT '',  -- 배송타입
  staff        TEXT NOT NULL DEFAULT '',  -- 다올직원
  supplier     TEXT NOT NULL DEFAULT '',  -- 매입처
  qty          TEXT NOT NULL DEFAULT '',  -- 수량
  shipper      TEXT NOT NULL DEFAULT '',  -- 보내는이
  company_name TEXT NOT NULL DEFAULT '',  -- 받는이
  address      TEXT NOT NULL DEFAULT '',  -- 배송주소
  phone        TEXT NOT NULL DEFAULT '',  -- 전화번호
  memo         TEXT NOT NULL DEFAULT '',  -- 비고
  status       TEXT NOT NULL DEFAULT '',  -- 배송상태 (배송완료/배송중 (…)/출고전/조회 실패 …)
  steps        JSONB NOT NULL DEFAULT '[]', -- 배송 진행 내역 [{text,time,done,current}, …] 최신순
  shipped_at   TEXT NOT NULL DEFAULT '',  -- 출고일
  added_at     TEXT NOT NULL DEFAULT '',  -- 등록일시 (프로그램 표기 형식 그대로)
  updated_at   TEXT NOT NULL DEFAULT '',  -- 수정일시 (프로그램 표기 형식 그대로)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_items_carrier_num ON delivery_items (carrier, num);
CREATE INDEX IF NOT EXISTS idx_delivery_items_order_date  ON delivery_items (order_date);
CREATE INDEX IF NOT EXISTS idx_delivery_items_status      ON delivery_items (status);

-- RLS: 활성화만 하고 정책은 만들지 않음 → anon(공개) 키로는 읽기/쓰기 불가.
-- Workers의 secret key(service role)는 RLS를 우회하므로 정상 동작.
ALTER TABLE delivery_items ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE delivery_items IS
  '운송장 조회 프로그램 데이터. Cloudflare Workers(/db/*) 경유로만 접근. local_id가 영구 행 식별자';
