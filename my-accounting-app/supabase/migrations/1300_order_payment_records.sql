-- =====================================================
-- 1300_order_payment_records.sql  (결제처리 트랙 — docs/payment-track.md)
-- 결제 기록(1차, 영업지원 수기 입력) + 2차 결제 확인 연결  (2026-11-13 사용자 확정)
--
-- 업무 흐름
--   1차: 영업지원이 주문 상세에서 "이렇게 결제됐다"를 기록한다 (카드결제 / 계좌이체 / 계산서 발행).
--        기록만으로는 미수가 줄지 않는다 — '확인 대기'.
--   2차: 회계 또는 다른 직원이 카드 매출 · 통장 입금 원본과 대조해 확정한다.
--        확정 = 기록의 주문별 금액대로 erp_payment_matches 행 생성(record_id 연결) → 표준 미수 뷰가 차감.
--   확인 해제 = record_id가 붙은 매칭 삭제 → 기록은 '확인 대기'로 돌아간다.
--
-- 결제 1건 ↔ 주문 여러 건(합산), 주문 1건 ↔ 결제 여러 건(분할) 모두 가능:
--   order_payment_records(머리) 1 : N order_payment_record_orders(주문별 금액)
--
-- 카드번호 전체 · 유효기간은 받지 않는다 — 대조 단서는 승인번호 + 카드 뒤 4자리.
-- 원본(card_sales · transactions · erp_orders)은 건드리지 않는다. 재실행 안전.
-- =====================================================

CREATE TABLE IF NOT EXISTS order_payment_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  method            TEXT NOT NULL CHECK (method IN ('card', 'transfer', 'invoice')),
  pay_date          DATE NOT NULL,                       -- 결제일 / 계산서 발행일
  amount            BIGINT NOT NULL CHECK (amount > 0),  -- 결제 1건의 금액 (= 주문별 금액 합)
  -- 대조 단서 (수단별)
  approval_number   TEXT,                                -- 카드: 승인번호
  card_last4        TEXT CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  depositor_name    TEXT,                                -- 이체: 입금자명
  due_date          DATE,                                -- 계산서 발행: 입금 예정일
  memo              TEXT,
  vendor_id         UUID REFERENCES vendors(id) ON DELETE SET NULL,   -- 기록 시점 매출처 (목록 표시 · 검색용)
  -- 1차 입력자
  created_by        UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_by_name   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 2차 확인자 (확인 해제 시 NULL로 되돌린다. 상태 판정의 원천은 erp_payment_matches.record_id)
  confirmed_by      UUID REFERENCES employees(id) ON DELETE SET NULL,
  confirmed_by_name TEXT,
  confirmed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_opr_pending  ON order_payment_records(pay_date) WHERE confirmed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_opr_approval ON order_payment_records(approval_number) WHERE approval_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opr_vendor   ON order_payment_records(vendor_id);

CREATE TABLE IF NOT EXISTS order_payment_record_orders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id  UUID NOT NULL REFERENCES order_payment_records(id) ON DELETE CASCADE,
  order_id   UUID NOT NULL REFERENCES erp_orders(id) ON DELETE CASCADE,
  amount     BIGINT NOT NULL CHECK (amount > 0),         -- 이 주문에 해당하는 금액
  UNIQUE (record_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_opro_order ON order_payment_record_orders(order_id);

-- 입력 · 수정 · 삭제 · 확인 · 확인 해제 이력 (기록이 지워져도 남는다 — FK 없음)
CREATE TABLE IF NOT EXISTS order_payment_record_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id     UUID NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'confirm', 'release')),
  employee_id   UUID,
  employee_name TEXT,
  detail        TEXT,                                    -- 요약 · 확인 해제 사유
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oprl_record ON order_payment_record_logs(record_id, created_at);

-- 2차 확인으로 만들어진 수금 매칭 ↔ 결제 기록
ALTER TABLE erp_payment_matches
  ADD COLUMN IF NOT EXISTS record_id UUID REFERENCES order_payment_records(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_erp_matches_record ON erp_payment_matches(record_id) WHERE record_id IS NOT NULL;

ALTER TABLE order_payment_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_payment_record_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_payment_record_logs   ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE order_payment_records IS
  '결제 기록(1차 수기 입력). 미수는 줄이지 않는다 — 2차 확인 시 erp_payment_matches(record_id)가 만들어지며 차감된다.';
COMMENT ON TABLE order_payment_record_orders IS
  '결제 기록 1건의 주문별 금액. 합계 = order_payment_records.amount.';
COMMENT ON COLUMN erp_payment_matches.record_id IS
  '이 매칭을 만든 결제 기록(2차 확인). NULL = 기록 없이 직접 매칭한 건.';

-- ── 검증 (실행 후 결과를 알려주세요) ──────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_name IN ('order_payment_records', 'order_payment_record_orders', 'order_payment_record_logs')) AS "테이블_기대3",
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'erp_payment_matches' AND column_name = 'record_id')                                    AS "매칭_record_id_기대1",
  (SELECT count(*) FROM order_payment_records)                                                                 AS "결제기록_건수_기대0",
  (SELECT count(*) FROM erp_payment_matches)                                                                   AS "기존매칭_건수_변동없음";
