-- =====================================================
-- 1400_inventory_stock.sql  (재고 관리 트랙 — docs/inventory-track.md)
-- 선매입 재고: 주문 품목 행 "재고" 칸 + 재고 원가 + 선입선출 배정 + 조정 · 실사 (2026-11-23 사용자 승인 시안)
--
-- 원칙
--  - 원본은 주문 품목 행(선매입 입고 · 재고 출고)과 조정 · 실사 기록. 재고 수량 · 금액은 저장하지 않고 계산한다.
--  - purchase_total(매입합계) = 매입처에 줄 돈. 뜻을 바꾸지 않는다(매입처 대사 · 미지급금 · 매입 사이클 그대로).
--  - stock_cost(재고 원가) = 재고에서 나간 물건의 원가. 저장 시 선입선출로 계산해 고정(이후 품목 매입가가 바뀌어도 불변).
--  - 마진 원가 = 매입합계 + 재고 원가, 선매입 입고 행은 마진 · 원가 집계에서 뺀다(이 파일의 025 · 035 함수 재정의).
--
-- 바뀌는 것
--  1) erp_order_items + stock_role('in' 선매입 입고 / 'out' 재고 출고 / NULL 없음) + stock_cost
--  2) erp_stock_adjustments (조정 — 실사 차이 · 기초재고 · 기타. + 는 입고분(단가 필요), − 는 선입선출로 차감)
--  3) erp_stock_stocktakes (실사 — 실사 수량 + 그때 전산재고 사본, 800 샘플 재고와 같은 방식)
--  4) erp_stock_allocations (배정 — 출고 행/− 조정이 어느 입고분에서 몇 개를 얼마에 가져갔는지)
--  5) 함수 erp_stock_allocate_order(주문) — 아직 배정 안 된 재고 출고 행을 품목별 잠금 아래 선입선출 배정
--     erp_stock_allocate_adjust(조정) — − 조정 배정
--  6) 뷰 v_erp_stock_lots (입고분별 남은 수량) · v_erp_stock_moves (배정 + 나간 날짜)
--  7) monthly_pl_order_summary(025) · vendor_sales_analysis(035) 원가 식 교체
--
-- 1400 미적용이어도 앱은 기존 동작(재고 칸을 쓰는 저장만 안내 문구로 막힘). 재실행 안전.
-- =====================================================

-- ── 1) 주문 품목 행: 재고 칸 · 재고 원가 ─────────────────────
ALTER TABLE erp_order_items
  ADD COLUMN IF NOT EXISTS stock_role TEXT,
  ADD COLUMN IF NOT EXISTS stock_cost BIGINT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_erp_items_stock_role') THEN
    ALTER TABLE erp_order_items
      ADD CONSTRAINT chk_erp_items_stock_role CHECK (stock_role IS NULL OR stock_role IN ('in', 'out'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_erp_items_stock
  ON erp_order_items(product_id, stock_role) WHERE stock_role IS NOT NULL;

COMMENT ON COLUMN erp_order_items.stock_role IS
  '재고 칸 (1400): in = 선매입 입고(판매가 0, 발주서 포함, 재고에 쌓임) / out = 재고 출고(매입가 · 매입배송비 0, 발주 제외, 재고 원가 발생) / NULL = 없음(기본).';
COMMENT ON COLUMN erp_order_items.stock_cost IS
  '재고 원가 (1400): 재고 출고 행이 가져간 입고분 금액 합(선입선출, 저장 시 고정). NULL = 아직 배정 안 됨(재고 부족 등 — 확인 필요). 마진 원가 = purchase_total + stock_cost.';

-- ── 2) 조정 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_stock_adjustments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID        NOT NULL REFERENCES erp_products(id) ON DELETE RESTRICT,
  adjust_date   DATE        NOT NULL,
  quantity      INTEGER     NOT NULL CHECK (quantity <> 0),     -- + 재고 증가(입고분) / − 재고 감소(선입선출 차감)
  unit_cost     NUMERIC(14,4),                                   -- + 조정의 단가(부가세 포함, 주문 매입가와 같은 기준). − 는 NULL(배정에서 정해짐)
  kind          TEXT        NOT NULL DEFAULT 'other' CHECK (kind IN ('stocktake', 'opening', 'other')),
  reason        TEXT        NOT NULL,
  stocktake_id  UUID,
  employee_id   UUID        REFERENCES employees(id) ON DELETE SET NULL,
  staff_name    TEXT,
  canceled_at   TIMESTAMPTZ,                                     -- 원본 보존: 지우지 않고 취소 표시
  canceled_by   UUID        REFERENCES employees(id) ON DELETE SET NULL,
  cancel_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_stock_adj_cost CHECK (quantity < 0 OR unit_cost IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_stock_adj_product ON erp_stock_adjustments(product_id, adjust_date);
COMMENT ON TABLE erp_stock_adjustments IS
  '선매입 재고 조정 (1400). 실사 차이(stocktake) · 기초재고(opening) · 기타. + 조정은 입고분이 되고, − 조정은 선입선출로 입고분에서 차감한다.';

-- ── 3) 실사 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_stock_stocktakes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  take_date    DATE        NOT NULL,
  product_id   UUID        NOT NULL REFERENCES erp_products(id) ON DELETE RESTRICT,
  counted_qty  INTEGER     NOT NULL CHECK (counted_qty >= 0),
  computed_qty INTEGER     NOT NULL,          -- 실사 시점 전산재고 사본 (차이 = counted − computed)
  employee_id  UUID        REFERENCES employees(id) ON DELETE SET NULL,
  staff_name   TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_stocktakes_date_product ON erp_stock_stocktakes(take_date, product_id);
COMMENT ON TABLE erp_stock_stocktakes IS
  '선매입 재고 실사 (1400). 차이 해소는 이 표 수정이 아니라 erp_stock_adjustments(kind=stocktake) 행 추가로 한다.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_stock_adj_stocktake') THEN
    ALTER TABLE erp_stock_adjustments
      ADD CONSTRAINT fk_stock_adj_stocktake FOREIGN KEY (stocktake_id) REFERENCES erp_stock_stocktakes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 4) 배정 (선입선출 결과) ──────────────────────────────
CREATE TABLE IF NOT EXISTS erp_stock_allocations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 가져간 쪽: 재고 출고 행 또는 − 조정 (둘 중 하나)
  out_item_id   UUID        REFERENCES erp_order_items(id) ON DELETE CASCADE,
  adjust_id     UUID        REFERENCES erp_stock_adjustments(id) ON DELETE CASCADE,
  -- 입고분: 선매입 입고 행 또는 + 조정 (둘 중 하나)
  lot_item_id   UUID        REFERENCES erp_order_items(id) ON DELETE RESTRICT,
  lot_adjust_id UUID        REFERENCES erp_stock_adjustments(id) ON DELETE RESTRICT,
  quantity      INTEGER     NOT NULL CHECK (quantity > 0),
  unit_cost     NUMERIC(14,4) NOT NULL,      -- 배정 시점 입고 단가 (고정)
  amount        BIGINT      NOT NULL,        -- round(quantity × unit_cost)
  moved_from_item_id UUID,                   -- 입고 행 수정 · 재발행으로 입고분이 옮겨졌을 때 원래 입고 행 (이력)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_stock_alloc_taker CHECK (num_nonnulls(out_item_id, adjust_id) = 1),
  CONSTRAINT chk_stock_alloc_lot   CHECK (num_nonnulls(lot_item_id, lot_adjust_id) = 1)
);
CREATE INDEX IF NOT EXISTS idx_stock_alloc_out     ON erp_stock_allocations(out_item_id)   WHERE out_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_alloc_adj     ON erp_stock_allocations(adjust_id)     WHERE adjust_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_alloc_lot     ON erp_stock_allocations(lot_item_id)   WHERE lot_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_alloc_lot_adj ON erp_stock_allocations(lot_adjust_id) WHERE lot_adjust_id IS NOT NULL;
COMMENT ON TABLE erp_stock_allocations IS
  '재고 배정 (1400): 재고 출고 행(또는 − 조정)이 어느 입고분에서 몇 개를 얼마에 가져갔는지. 가져간 쪽이 취소되면(행 취소 · 조정 취소) 계산에서 빠져 재고가 자동으로 돌아온다(행은 이력으로 남김).';

-- ── 6) 뷰 ───────────────────────────────────────────────
-- 유효한 배정: 가져간 쪽이 살아 있는 것만 (취소된 출고 행 · 취소된 조정은 제외)
CREATE OR REPLACE VIEW v_erp_stock_moves AS
SELECT a.id, a.out_item_id, a.adjust_id, a.lot_item_id, a.lot_adjust_id,
       a.quantity, a.unit_cost, a.amount, a.moved_from_item_id, a.created_at,
       COALESCE(oi.product_id, ad.product_id)  AS product_id,
       COALESCE(o.order_date, ad.adjust_date)  AS move_date,
       oi.order_id                             AS out_order_id
FROM erp_stock_allocations a
LEFT JOIN erp_order_items oi     ON oi.id = a.out_item_id
LEFT JOIN erp_orders o           ON o.id = oi.order_id
LEFT JOIN erp_stock_adjustments ad ON ad.id = a.adjust_id
WHERE (a.out_item_id IS NOT NULL AND oi.is_canceled = false AND oi.stock_role = 'out')
   OR (a.adjust_id   IS NOT NULL AND ad.canceled_at IS NULL);

-- 입고분: 유효한 선매입 입고 행 + 유효한 + 조정. 남은 수량 = 수량 − 유효 배정
CREATE OR REPLACE VIEW v_erp_stock_lots AS
WITH lots AS (
  SELECT i.id AS lot_item_id, NULL::uuid AS lot_adjust_id, i.product_id, o.order_date AS lot_date,
         i.created_at, i.quantity::int AS quantity,
         CASE WHEN COALESCE(i.quantity, 0) > 0 THEN COALESCE(i.purchase_total, 0)::numeric / i.quantity ELSE 0 END AS unit_cost,
         i.order_id, o.order_no, i.line_no
  FROM erp_order_items i
  JOIN erp_orders o ON o.id = i.order_id
  WHERE i.stock_role = 'in' AND i.is_canceled = false AND i.product_id IS NOT NULL
  UNION ALL
  SELECT NULL::uuid, ad.id, ad.product_id, ad.adjust_date, ad.created_at, ad.quantity, ad.unit_cost,
         NULL::uuid, NULL::varchar, NULL::smallint
  FROM erp_stock_adjustments ad
  WHERE ad.quantity > 0 AND ad.canceled_at IS NULL
)
SELECT l.*,
       COALESCE((SELECT SUM(m.quantity) FROM v_erp_stock_moves m
                  WHERE (l.lot_item_id IS NOT NULL AND m.lot_item_id = l.lot_item_id)
                     OR (l.lot_adjust_id IS NOT NULL AND m.lot_adjust_id = l.lot_adjust_id)), 0)::int AS used_qty,
       l.quantity - COALESCE((SELECT SUM(m.quantity) FROM v_erp_stock_moves m
                  WHERE (l.lot_item_id IS NOT NULL AND m.lot_item_id = l.lot_item_id)
                     OR (l.lot_adjust_id IS NOT NULL AND m.lot_adjust_id = l.lot_adjust_id)), 0)::int AS remaining_qty
FROM lots l;

-- ── 5) 선입선출 배정 함수 ─────────────────────────────────
-- 품목 하나에서 p_qty 개를 먼저 들어온 입고분부터 가져간다. 모자라면 아무것도 넣지 않고 false.
CREATE OR REPLACE FUNCTION erp_stock_take_fifo(
  p_product UUID, p_qty INTEGER, p_out_item UUID, p_adjust UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  v_avail INTEGER;
  v_left  INTEGER := p_qty;
  v_take  INTEGER;
  r RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('erp_stock:' || p_product::text, 0));
  SELECT COALESCE(SUM(remaining_qty), 0) INTO v_avail FROM v_erp_stock_lots WHERE product_id = p_product AND remaining_qty > 0;
  IF v_avail < p_qty THEN RETURN false; END IF;
  FOR r IN
    SELECT lot_item_id, lot_adjust_id, remaining_qty, unit_cost
      FROM v_erp_stock_lots
     WHERE product_id = p_product AND remaining_qty > 0
     ORDER BY lot_date, created_at, COALESCE(lot_item_id, lot_adjust_id)
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, r.remaining_qty);
    INSERT INTO erp_stock_allocations (out_item_id, adjust_id, lot_item_id, lot_adjust_id, quantity, unit_cost, amount)
    VALUES (p_out_item, p_adjust, r.lot_item_id, r.lot_adjust_id, v_take, r.unit_cost, ROUND(v_take * r.unit_cost));
    v_left := v_left - v_take;
  END LOOP;
  RETURN true;
END $$;

-- 주문의 재고 출고 행 중 아직 배정 안 된 것을 배정하고 재고 원가를 고정한다. 결과 = { allocated, short: [...] }
CREATE OR REPLACE FUNCTION erp_stock_allocate_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  v_ok BOOLEAN;
  v_done INTEGER := 0;
  v_short JSONB := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT i.id, i.product_id, i.quantity, i.line_no
      FROM erp_order_items i
     WHERE i.order_id = p_order_id AND i.stock_role = 'out' AND i.is_canceled = false
       AND i.product_id IS NOT NULL AND COALESCE(i.quantity, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM erp_stock_allocations a WHERE a.out_item_id = i.id)
     ORDER BY i.line_no
  LOOP
    v_ok := erp_stock_take_fifo(r.product_id, r.quantity, r.id, NULL);
    IF v_ok THEN
      UPDATE erp_order_items
         SET stock_cost = (SELECT COALESCE(SUM(amount), 0) FROM erp_stock_allocations WHERE out_item_id = r.id)
       WHERE id = r.id;
      v_done := v_done + 1;
    ELSE
      v_short := v_short || jsonb_build_object('item_id', r.id, 'line_no', r.line_no, 'product_id', r.product_id, 'need', r.quantity);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('allocated', v_done, 'short', v_short);
END $$;

-- − 조정 배정 (실사 부족 등)
CREATE OR REPLACE FUNCTION erp_stock_allocate_adjust(p_adjust_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
  SELECT id, product_id, quantity INTO r FROM erp_stock_adjustments
   WHERE id = p_adjust_id AND quantity < 0 AND canceled_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM erp_stock_allocations WHERE adjust_id = p_adjust_id) THEN RETURN true; END IF;
  RETURN erp_stock_take_fifo(r.product_id, -r.quantity, NULL, r.id);
END $$;

-- ── 7) 원가 식 교체: 원가 = 매입합계 + 재고 원가, 선매입 입고 행 제외 ──
CREATE OR REPLACE FUNCTION monthly_pl_order_summary(
  p_from DATE,
  p_to   DATE
)
RETURNS TABLE (month TEXT, revenue BIGINT, cogs BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT
    to_char(o.order_date, 'YYYY-MM') AS month,
    COALESCE(SUM(i.line_total), 0)::BIGINT AS revenue,
    COALESCE(SUM(CASE WHEN i.stock_role = 'in' THEN 0
                      ELSE COALESCE(i.purchase_total, 0) + COALESCE(i.stock_cost, 0) END), 0)::BIGINT AS cogs
  FROM erp_order_items i
  JOIN erp_orders o ON o.id = i.order_id
  WHERE o.order_date BETWEEN p_from AND p_to
    AND NOT i.is_canceled
    AND NOT i.is_vip
    AND NOT i.is_prepayment
  GROUP BY 1
$$;

CREATE OR REPLACE FUNCTION vendor_sales_analysis(
  p_from DATE,
  p_to   DATE
)
RETURNS TABLE (
  alias_id        UUID,
  erp_name        TEXT,
  vendor_id       UUID,
  vendor_name     TEXT,
  order_count     BIGINT,
  item_count      BIGINT,
  quantity        BIGINT,
  sales_amount    BIGINT,
  purchase_amount BIGINT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    o.customer_alias_id                         AS alias_id,
    a.erp_name                                  AS erp_name,
    a.vendor_id                                 AS vendor_id,
    v.name                                      AS vendor_name,
    COUNT(DISTINCT i.order_id)                  AS order_count,
    COUNT(*)                                    AS item_count,
    COALESCE(SUM(i.quantity), 0)::BIGINT        AS quantity,
    COALESCE(SUM(i.line_total), 0)::BIGINT      AS sales_amount,
    COALESCE(SUM(COALESCE(i.purchase_total, 0) + COALESCE(i.stock_cost, 0)), 0)::BIGINT AS purchase_amount
  FROM erp_order_items i
  JOIN erp_orders o            ON o.id = i.order_id
  LEFT JOIN erp_vendor_aliases a ON a.id = o.customer_alias_id
  LEFT JOIN vendors v            ON v.id = a.vendor_id
  WHERE i.is_canceled   = false
    AND i.is_vip        = false
    AND i.is_prepayment = false
    AND i.stock_role IS DISTINCT FROM 'in'       -- 1400: 선매입 입고는 매출처 수익성에서 뺀다
    AND (p_from IS NULL OR o.order_date >= p_from)
    AND (p_to   IS NULL OR o.order_date <= p_to)
  GROUP BY o.customer_alias_id, a.erp_name, a.vendor_id, v.name
$$;

-- ── RLS (서비스 키 경유 API만 접근) ───────────────────
ALTER TABLE erp_stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_stock_stocktakes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_stock_allocations ENABLE ROW LEVEL SECURITY;

-- ── 확인 ────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'erp_order_items' AND column_name LIKE 'stock_%';  -- 2행
-- SELECT COUNT(*) FROM v_erp_stock_lots;   -- 0 (선매입 입고 행이 생기기 전)
-- SELECT erp_stock_allocate_order('00000000-0000-0000-0000-000000000000');  -- {"short": [], "allocated": 0}
