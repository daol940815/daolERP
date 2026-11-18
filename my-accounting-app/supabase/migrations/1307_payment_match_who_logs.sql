-- =====================================================
-- 1307_payment_match_who_logs.sql  (결제처리 트랙 — docs/payment-track.md)
-- 수금 매칭 — 누가 · 언제 매칭했는지, 매칭 해제의 사유 · 사람 · 시각  (2026-11-18 사용자 요청)
--
-- ① erp_payment_matches 에 매칭한 사람(matched_by_id · matched_by_name). 시각은 created_at.
--    이전 매칭은 NULL(누가 했는지 기록 없음) — 추정해 채우지 않는다.
-- ② erp_payment_match_logs: 매칭 · 해제 이력. 해제하면 매칭 행은 지워지므로 여기에 금액 · 원본 · 사유 · 사람 · 시각이 남는다.
--    (FK 없음 — 주문 · 매칭이 지워져도 이력은 남는다)
-- 원본은 건드리지 않는다. 재실행 안전.
-- =====================================================

ALTER TABLE erp_payment_matches ADD COLUMN IF NOT EXISTS matched_by_id   UUID;
ALTER TABLE erp_payment_matches ADD COLUMN IF NOT EXISTS matched_by_name TEXT;
COMMENT ON COLUMN erp_payment_matches.matched_by_name IS '매칭한 직원 이름(1307). 자동으로 넘어온 행 · 1307 이전 행은 NULL. 시각은 created_at';

CREATE TABLE IF NOT EXISTS erp_payment_match_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action        TEXT NOT NULL CHECK (action IN ('match', 'unmatch')),
  match_id      UUID,
  order_id      UUID,
  order_no      TEXT,
  source_type   TEXT,
  source_id     UUID,
  amount        BIGINT,
  paid_date     DATE,
  record_id     UUID,                 -- 결제 기록에 연결된 매칭이었으면 그 기록
  origin        TEXT,                 -- 어느 화면 · 동작에서 (기록 없는 입금 · 결제 확인 · 주문 쪽 수금 매칭 …)
  reason_code   TEXT,                 -- 해제 사유 항목 (lib/payment-reasons.ts 'release')
  reason_text   TEXT,
  employee_id   UUID,
  employee_name TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_epml_order   ON erp_payment_match_logs(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_epml_created ON erp_payment_match_logs(created_at DESC);
ALTER TABLE erp_payment_match_logs ENABLE ROW LEVEL SECURITY;

-- ── 검증 (실행 뒤 결과를 알려 주세요) ─────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'erp_payment_matches' AND column_name IN ('matched_by_id', 'matched_by_name')) AS new_columns,   -- 기대 2
  (SELECT count(*) FROM information_schema.tables  WHERE table_name = 'erp_payment_match_logs') AS log_table,                                                        -- 기대 1
  (SELECT count(*) FROM erp_payment_matches) AS total_matches,
  (SELECT count(*) FROM erp_payment_matches WHERE matched_by_name IS NOT NULL) AS with_who;                                                                          -- 기대 0
