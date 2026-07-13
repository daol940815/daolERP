-- =====================================================
-- 019_erp_orders.sql
-- 자사 ERP 주문 데이터 보관 테이블
-- ERP에서 다운로드한 주문/품목 내역을 저장하여
-- 매출처별 미수금, 매입처별 미결제(월 정산) 현황을 관리
-- =====================================================

-- ── ERP 업체명 ↔ 거래처 매핑 ─────────────────────────
-- ERP에 기재된 지점명/매입처명은 계산서상 업체명과 다를 수 있어
-- 한 번 수동 연결하면 이후 업로드부터 자동 적용되는 별칭 테이블
CREATE TABLE IF NOT EXISTS erp_vendor_aliases (
  id           UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  -- customer: 매출처(은행+지점) / purchase: 매입처
  alias_type   VARCHAR(10)  NOT NULL CHECK (alias_type IN ('customer', 'purchase')),
  erp_name     VARCHAR(200) NOT NULL,
  vendor_id    UUID REFERENCES vendors(id) ON DELETE SET NULL,
  -- 매입처 결제 방식: advance(선입금 후출고) / monthly(월말정산)
  payment_term VARCHAR(10)  DEFAULT 'monthly' CHECK (payment_term IN ('advance', 'monthly')),
  created_at   TIMESTAMPTZ  DEFAULT now(),
  updated_at   TIMESTAMPTZ  DEFAULT now(),
  UNIQUE (alias_type, erp_name)
);

-- ── ERP 주문 (매출처/수금 관리 기준) ──────────────────
CREATE TABLE IF NOT EXISTS erp_orders (
  id                  UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  order_no            VARCHAR(50)  NOT NULL UNIQUE,
  order_date          DATE         NOT NULL,
  bank_name           VARCHAR(100),
  branch_name         VARCHAR(100),
  customer_alias_id   UUID REFERENCES erp_vendor_aliases(id) ON DELETE SET NULL,
  manager_name        VARCHAR(100),  -- 담당자(지점측)
  staff_name          VARCHAR(100),  -- 다올직원
  contact             VARCHAR(50),
  phone               VARCHAR(50),
  introducer          VARCHAR(100),
  supervisor          VARCHAR(100),
  supervisor_contact  VARCHAR(50),
  total_amount        BIGINT       DEFAULT 0,
  outstanding_amount  BIGINT       DEFAULT 0,  -- 미수금
  -- collected(수금완료) / outstanding(미수금) / in_progress(수금진행중)
  collect_status      VARCHAR(20)  DEFAULT 'outstanding'
                      CHECK (collect_status IN ('collected', 'outstanding', 'in_progress')),
  memo                TEXT,
  etc                 TEXT,
  created_at          TIMESTAMPTZ  DEFAULT now(),
  updated_at          TIMESTAMPTZ  DEFAULT now()
);

-- ── ERP 주문 품목 (매입처/정산 관리 기준) ─────────────
CREATE TABLE IF NOT EXISTS erp_order_items (
  id                    UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id              UUID         NOT NULL REFERENCES erp_orders(id) ON DELETE CASCADE,
  line_no               SMALLINT     NOT NULL,
  -- 취소 건: 모든 매출/매입 집계에서 제외, 화면에 취소 배지
  is_canceled           BOOLEAN      DEFAULT false,
  -- VIP(품명='VIP' 이고 판매가=매입가): 집계 제외, 별도 관리
  is_vip                BOOLEAN      DEFAULT false,
  -- 선결제(품명='선결제'): 집계 제외, 매출처 선결제 원장에 입금 자동 등록
  is_prepayment         BOOLEAN      DEFAULT false,
  item_code             VARCHAR(50),
  item_name             VARCHAR(300),
  order_kind            VARCHAR(20),   -- 지점/개별/샘플
  purchase_vendor_name  VARCHAR(200),
  purchase_alias_id     UUID REFERENCES erp_vendor_aliases(id) ON DELETE SET NULL,
  sale_price            BIGINT       DEFAULT 0,
  quantity              INTEGER      DEFAULT 0,
  shipping_fee          BIGINT       DEFAULT 0,
  discount_amount       BIGINT       DEFAULT 0,
  line_total            BIGINT       DEFAULT 0,  -- 합계금액(매출 기준값)
  line_outstanding      BIGINT       DEFAULT 0,  -- 품목 단위 미수금
  purchase_price        BIGINT       DEFAULT 0,  -- 매입가(단가)
  purchase_shipping     BIGINT       DEFAULT 0,
  purchase_total        BIGINT       DEFAULT 0,  -- 매입가*갯수+매입배송비
  -- 매입 정산 귀속월 (기본=주문월, 화면에서 이월 가능)
  settlement_month      VARCHAR(7),
  channel               VARCHAR(100),  -- 채널/상담자 (파일 형식별 차이 흡수)
  memo                  TEXT,
  created_at            TIMESTAMPTZ  DEFAULT now(),
  updated_at            TIMESTAMPTZ  DEFAULT now(),
  UNIQUE (order_id, line_no)
);

-- ── 매입처 월 정산 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_purchase_settlements (
  id                 UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  purchase_alias_id  UUID         NOT NULL REFERENCES erp_vendor_aliases(id) ON DELETE CASCADE,
  settlement_month   VARCHAR(7)   NOT NULL,  -- 'YYYY-MM'
  status             VARCHAR(10)  DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
  paid_date          DATE,
  paid_amount        BIGINT,       -- 실제 결제액 (품목 합계와 차액 비교용)
  memo               TEXT,
  created_at         TIMESTAMPTZ  DEFAULT now(),
  updated_at         TIMESTAMPTZ  DEFAULT now(),
  UNIQUE (purchase_alias_id, settlement_month)
);

-- ── 선결제/선입금 원장 (매출처·매입처 공용) ───────────
CREATE TABLE IF NOT EXISTS erp_prepayments (
  id             UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  -- customer: 매출처가 우리에게 선결제 / purchase: 우리가 매입처에 선입금
  direction      VARCHAR(10)  NOT NULL CHECK (direction IN ('customer', 'purchase')),
  alias_id       UUID         NOT NULL REFERENCES erp_vendor_aliases(id) ON DELETE CASCADE,
  entry_date     DATE         NOT NULL,
  entry_type     VARCHAR(10)  NOT NULL CHECK (entry_type IN ('deposit', 'deduction')),
  amount         BIGINT       NOT NULL,
  order_id       UUID REFERENCES erp_orders(id) ON DELETE SET NULL,
  settlement_id  UUID REFERENCES erp_purchase_settlements(id) ON DELETE SET NULL,
  -- 업로드 시 자동 생성되는 입금 건의 멱등키 (재업로드 중복 방지)
  source_key     TEXT UNIQUE,
  memo           TEXT,
  created_at     TIMESTAMPTZ  DEFAULT now(),
  updated_at     TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erp_orders_date          ON erp_orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_erp_orders_customer      ON erp_orders(customer_alias_id);
CREATE INDEX IF NOT EXISTS idx_erp_orders_status        ON erp_orders(collect_status);
CREATE INDEX IF NOT EXISTS idx_erp_items_order          ON erp_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_erp_items_purchase       ON erp_order_items(purchase_alias_id);
CREATE INDEX IF NOT EXISTS idx_erp_items_settle_month   ON erp_order_items(settlement_month);
CREATE INDEX IF NOT EXISTS idx_erp_prepay_alias         ON erp_prepayments(alias_id);
CREATE INDEX IF NOT EXISTS idx_erp_settle_alias         ON erp_purchase_settlements(purchase_alias_id);

DROP TRIGGER IF EXISTS trg_erp_aliases_updated_at ON erp_vendor_aliases;
CREATE TRIGGER trg_erp_aliases_updated_at
  BEFORE UPDATE ON erp_vendor_aliases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_erp_orders_updated_at ON erp_orders;
CREATE TRIGGER trg_erp_orders_updated_at
  BEFORE UPDATE ON erp_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_erp_items_updated_at ON erp_order_items;
CREATE TRIGGER trg_erp_items_updated_at
  BEFORE UPDATE ON erp_order_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_erp_settlements_updated_at ON erp_purchase_settlements;
CREATE TRIGGER trg_erp_settlements_updated_at
  BEFORE UPDATE ON erp_purchase_settlements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_erp_prepayments_updated_at ON erp_prepayments;
CREATE TRIGGER trg_erp_prepayments_updated_at
  BEFORE UPDATE ON erp_prepayments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
