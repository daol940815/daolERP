-- =====================================================
-- 800_sample_stock.sql
-- 요아럽 샘플 재고 트랙 — 사무실 입출고 원장 + 재고 실사 + 품목 플래그
-- (번호 규칙: 샘플 재고 트랙은 800번대 — docs/sample-stock-track.md)
--
-- 배경: 요아럽(매입처) 제품을 다올커머스 사무실에 들여와 영업 샘플·선물
-- 증정용으로 소진. 엑셀 원장으로 관리하던 사무실 입출고를 ERP로 편입한다.
--
-- 확정 구조 (2026-08-18 사용자 결정):
-- 1) 요아럽 창고 출고 샘플(기존 erp_order_items order_kind='샘플')과
--    사무실 출고는 별개 — 재고 관리는 사무실 입출고만 대상.
--    이 테이블 자체가 "사무실" 위치 표식이므로 주문내역에 위치 컬럼을 추가하지 않는다.
-- 2) 비용 집계는 창고+사무실 통합 — 화면에서 두 소스를 합산 (창고 행 무수정).
-- 3) 원본데이터 철학: 입출고 원장이 원본, 전산재고는 입고 누계 − 출고 누계로
--    파생 계산(저장하지 않음). 실재고는 실사 기록, 오차 해소는 adjust 원장 행.
-- 4) 품목은 별도 테이블 없이 품목 마스터(erp_products) 참조.
-- =====================================================

-- ── 1) 사무실 입출고 원장 ─────────────────────────────
CREATE TABLE IF NOT EXISTS erp_sample_moves (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  move_date     DATE        NOT NULL,
  move_type     TEXT        NOT NULL CHECK (move_type IN ('in', 'out', 'adjust')),
  product_id    UUID        REFERENCES erp_products(id) ON DELETE SET NULL,
  item_name_raw VARCHAR(300),                -- 엑셀 원본 품명 보존 (이관 행은 필수 기재)
  -- in/out은 양수, adjust는 부호 포함(+ 증가 / − 감소)·0 금지
  quantity      INTEGER     NOT NULL,
  unit_cost     BIGINT,                      -- 기록 시점 매입가 스냅샷
  total_cost    BIGINT,                      -- 기록 시점 매입합계 (엑셀 기록값 보존)
  purpose       TEXT        CHECK (purpose IN ('sales', 'gift')),   -- 용도 (출고만)
  dest_name     TEXT,                        -- 출고처 원본 텍스트 (자유 입력)
  staff_name    TEXT,                        -- 담당자 원본 표기 (퇴사자 포함 보존)
  employee_id   UUID        REFERENCES employees(id) ON DELETE SET NULL,  -- 직원 마스터 선택 연결
  contact_id    UUID        REFERENCES contacts(id)  ON DELETE SET NULL,  -- 거래처 담당자 선택 연결 (영업일지 연계)
  note          TEXT,
  source        TEXT        NOT NULL DEFAULT 'manual' CHECK (source IN ('excel', 'manual')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_sample_moves_qty
    CHECK (CASE WHEN move_type = 'adjust' THEN quantity <> 0 ELSE quantity > 0 END),
  CONSTRAINT chk_sample_moves_purpose
    CHECK (purpose IS NULL OR move_type = 'out')
);

CREATE INDEX IF NOT EXISTS idx_sample_moves_product ON erp_sample_moves(product_id, move_date DESC) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sample_moves_date    ON erp_sample_moves(move_date DESC);
CREATE INDEX IF NOT EXISTS idx_sample_moves_emp     ON erp_sample_moves(employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sample_moves_contact ON erp_sample_moves(contact_id)  WHERE contact_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_sample_moves_updated_at ON erp_sample_moves;
CREATE TRIGGER trg_sample_moves_updated_at
  BEFORE UPDATE ON erp_sample_moves
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE erp_sample_moves IS
  '요아럽 샘플 사무실 입출고 원장 (원본). 전산재고 = 입고 누계 − 출고 누계 ± 조정으로 파생 계산. 요아럽 창고 출고분은 기존 주문내역 샘플 행을 그대로 사용하며 여기에 넣지 않는다.';
COMMENT ON COLUMN erp_sample_moves.item_name_raw IS '엑셀 원본 품명 보존. product_id가 NULL이어도 원본 표기는 남는다.';
COMMENT ON COLUMN erp_sample_moves.quantity      IS 'in/out은 양수. adjust는 부호 포함(+ 재고 증가 / − 재고 감소), 0 금지.';
COMMENT ON COLUMN erp_sample_moves.purpose       IS '출고 용도: sales(영업샘플) / gift(선물증정). 출고 행에만 기재.';
COMMENT ON COLUMN erp_sample_moves.staff_name    IS '담당자 원본 표기 보존. 직원 마스터 일치 시 employee_id를 함께 연결 (주문내역 staff_name 패턴과 동일).';

-- ── 2) 재고 실사 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_sample_stocktakes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  take_date    DATE        NOT NULL,
  product_id   UUID        NOT NULL REFERENCES erp_products(id) ON DELETE CASCADE,
  counted_qty  INTEGER     NOT NULL,        -- 실사 수량
  computed_qty INTEGER     NOT NULL,        -- 실사 시점 전산재고 스냅샷 (오차 = counted − computed)
  staff_name   TEXT,                        -- 실사자 원본 표기
  employee_id  UUID        REFERENCES employees(id) ON DELETE SET NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 같은 날 같은 품목 실사는 1건 (재실사는 날짜를 달리하거나 기존 행 갱신)
CREATE UNIQUE INDEX IF NOT EXISTS uq_sample_stocktakes_date_product
  ON erp_sample_stocktakes(take_date, product_id);
CREATE INDEX IF NOT EXISTS idx_sample_stocktakes_product
  ON erp_sample_stocktakes(product_id, take_date DESC);

COMMENT ON TABLE erp_sample_stocktakes IS
  '샘플 재고 실사 기록. 오차 해소는 이 테이블 수정이 아니라 원장의 adjust 행 추가로 한다 (원본 무수정 원칙).';

-- ── 3) 품목 마스터 플래그 ─────────────────────────────
-- 재고 화면 대상 품목 지정. 이관 스크립트가 원장 등장 품목에 true를 세팅하고,
-- 이후 신규 품목은 화면에서 지정한다.
ALTER TABLE erp_products
  ADD COLUMN IF NOT EXISTS is_sample_stock BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_erp_products_sample_stock
  ON erp_products(is_sample_stock) WHERE is_sample_stock;

COMMENT ON COLUMN erp_products.is_sample_stock IS
  '요아럽 샘플 재고 관리 대상 품목 여부 (사무실 재고 화면 노출 기준).';

-- ── RLS (서비스 키 경유 API만 접근) ───────────────────
ALTER TABLE erp_sample_moves      ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_sample_stocktakes ENABLE ROW LEVEL SECURITY;
