-- =====================================================
-- 500_order_system_phase2.sql
-- 주문시스템 2단계 — 품목 마스터 + 직접 입력 주문 + 수정 승인 워크플로
-- (번호 규칙: 주문시스템 트랙은 500번대 — docs/order-system-track.md)
--
-- 1) erp_products: 품목 마스터. 주문 입력 시 품번·품명 검색 → 매입처·가격
--    자동 채움의 원천. 상품 엑셀(품번·품명·매입처·판매가·매입가) 업로드로
--    적재하고, 화면에서 개별 등록·수정한다.
--    * 품번 체계가 미확정이라 item_code는 NULL 허용 + 값이 있으면 유일.
-- 2) erp_orders 직접 입력 컬럼: 주문처(vendors)·거래처 담당자(contacts)·
--    상담자(employees)·입력 직원(employees)을 마스터 FK로 기록한다.
--    기존 텍스트 컬럼(bank_name/manager_name/staff_name/channel)은 저장 시
--    함께 채워 하류(허브·수금 매칭·회계)가 수정 없이 두 소스를 소비한다.
-- 3) erp_order_items.product_id: 품목 마스터 연결(선택). 원본 행 텍스트는 유지.
-- 4) erp_order_change_requests: 익일 이후 수정·취소 요청 → 중간 관리자 승인.
--    음수 상계 주문 방식 폐지의 대체 장치. 요청에 변경 전·후 스냅샷을 남겨
--    감사 이력이 남는다.
-- =====================================================

-- ── 1) 품목 마스터 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_products (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code             VARCHAR(50),                 -- 품번 (체계 미확정 — NULL 허용)
  item_name             VARCHAR(300) NOT NULL,
  purchase_vendor_name  VARCHAR(200),                -- 매입처 표기 (발주서 분리 기준)
  purchase_alias_id     UUID REFERENCES erp_vendor_aliases(id) ON DELETE SET NULL,
  sale_price            BIGINT       NOT NULL DEFAULT 0,   -- 기본 판매가 (행에서 수정 가능)
  purchase_price        BIGINT       NOT NULL DEFAULT 0,   -- 기본 매입가
  is_active             BOOLEAN      NOT NULL DEFAULT true,
  memo                  TEXT,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- 품번은 있으면 유일 (NULL 여러 개 허용)
CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_products_item_code
  ON erp_products(item_code) WHERE item_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_erp_products_name ON erp_products(item_name);

DROP TRIGGER IF EXISTS trg_erp_products_updated_at ON erp_products;
CREATE TRIGGER trg_erp_products_updated_at
  BEFORE UPDATE ON erp_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2) 주문 직접 입력 컬럼 ────────────────────────────
ALTER TABLE erp_orders
  ADD COLUMN IF NOT EXISTS vendor_id              UUID REFERENCES vendors(id)   ON DELETE SET NULL,  -- 주문처 (direct: 마스터 선택)
  ADD COLUMN IF NOT EXISTS contact_id             UUID REFERENCES contacts(id)  ON DELETE SET NULL,  -- 거래처 담당자
  ADD COLUMN IF NOT EXISTS counselor_employee_id  UUID REFERENCES employees(id) ON DELETE SET NULL,  -- 상담자
  ADD COLUMN IF NOT EXISTS created_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;  -- 입력 직원 (로그인 자동)

CREATE INDEX IF NOT EXISTS idx_erp_orders_vendor     ON erp_orders(vendor_id)              WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_erp_orders_created_by ON erp_orders(created_by_employee_id) WHERE created_by_employee_id IS NOT NULL;

COMMENT ON COLUMN erp_orders.vendor_id              IS 'direct 주문의 주문처 (vendors 마스터 선택). upload 주문은 별칭 경유라 NULL.';
COMMENT ON COLUMN erp_orders.contact_id             IS 'direct 주문의 거래처 담당자 (contacts 마스터). manager_name 텍스트는 하류 호환용으로 병기.';
COMMENT ON COLUMN erp_orders.counselor_employee_id  IS 'direct 주문의 상담자 (employees 마스터). 품목 channel 텍스트는 하류 호환용으로 병기.';
COMMENT ON COLUMN erp_orders.created_by_employee_id IS 'direct 주문의 입력 직원 — 로그인 계정 자동 기록. 당일 수정 권한 판정 기준.';

-- ── 3) 품목 행 → 품목 마스터 연결 ─────────────────────
ALTER TABLE erp_order_items
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES erp_products(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_erp_items_product ON erp_order_items(product_id) WHERE product_id IS NOT NULL;

COMMENT ON COLUMN erp_order_items.product_id IS 'direct 주문에서 선택한 품목 마스터. 텍스트(item_code/item_name 등)는 주문 시점 값으로 보존.';

-- ── 4) 수정·취소 요청 (익일 이후 → manager 승인) ──────
CREATE TABLE IF NOT EXISTS erp_order_change_requests (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID        NOT NULL REFERENCES erp_orders(id) ON DELETE CASCADE,
  request_type   TEXT        NOT NULL CHECK (request_type IN ('edit', 'cancel')),
  requested_by   UUID        REFERENCES employees(id) ON DELETE SET NULL,
  reason         TEXT        NOT NULL,               -- 요청 사유 (필수)
  before_snapshot JSONB      NOT NULL,               -- 요청 시점의 주문+품목 스냅샷 (감사용)
  payload        JSONB,                              -- edit: 제안된 주문+품목 전체 값 / cancel: NULL
  status         TEXT        NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by     UUID        REFERENCES employees(id) ON DELETE SET NULL,
  decided_at     TIMESTAMPTZ,
  decision_memo  TEXT,                               -- 반려 사유 등
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocr_pending ON erp_order_change_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ocr_order   ON erp_order_change_requests(order_id);

COMMENT ON TABLE erp_order_change_requests IS
  '주문 수정·취소 요청. 당일은 자유 수정이라 요청 없이 직접 반영, 익일 이후는 이 요청을 manager/admin이 승인해야 반영된다.';

-- ── RLS (서비스 키 경유 API만 접근) ───────────────────
ALTER TABLE erp_products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_order_change_requests ENABLE ROW LEVEL SECURITY;
