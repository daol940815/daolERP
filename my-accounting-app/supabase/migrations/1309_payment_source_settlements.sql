-- =====================================================
-- 1309_payment_source_settlements.sql  (결제처리 트랙 — docs/payment-track.md)
-- 이전 처리분 — 주문 없이 이미 처리된 입금 · 카드 결제를 "처리 완료"로 표시  (2026-11-23 사용자 승인, 시안 docs/mockups/입금대장_이전처리분_시안.html)
--
-- 쓰는 곳: 결제 확인 › 입금대장에서 체크 → "이전 처리분 확정"(사유 필수). 표시된 원본은 입금대장 · 결제 확인 원본 후보 · 수금 후보에서 빠진다.
-- 해제도 사유 필수. 표시 · 해제 모두 이 표에 남는다(해제 = released_at 채움, 행을 지우지 않음).
-- 원본(transactions · card_sales)과 미수 · 매출은 바뀌지 않는다. 재실행 안전.
-- =====================================================

CREATE TABLE IF NOT EXISTS payment_source_settlements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type         TEXT NOT NULL CHECK (source_type IN ('bank', 'card')),
  source_id           UUID NOT NULL,                 -- transactions.id / card_sales.id (승인 행)
  amount              BIGINT NOT NULL,               -- 표시할 때의 남은 금액(참고)
  tx_date             DATE,
  label               TEXT,                          -- 입금자 · 카드번호 (표시용 사본)
  vendor_id           UUID,
  reason_code         TEXT NOT NULL,
  reason_text         TEXT NOT NULL,
  memo                TEXT,
  created_by          UUID,
  created_by_name     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at         TIMESTAMPTZ,
  released_by         UUID,
  released_by_name    TEXT,
  release_reason_code TEXT,
  release_reason_text TEXT
);
-- 원본 하나에 살아 있는 표시는 하나만
CREATE UNIQUE INDEX IF NOT EXISTS uq_pss_active ON payment_source_settlements(source_type, source_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pss_created ON payment_source_settlements(created_at DESC);
ALTER TABLE payment_source_settlements ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE payment_source_settlements IS '이전 처리분 — 주문에 붙이지 않고 처리 완료로 표시한 입금 · 카드 결제(결제처리 1309). released_at 이 비어 있는 행이 살아 있는 표시';

-- ── 검증 ─────────────────────────────────────
SELECT (SELECT count(*) FROM information_schema.tables WHERE table_name = 'payment_source_settlements') AS table_created,   -- 기대 1
       (SELECT count(*) FROM payment_source_settlements) AS rows_now;                                                       -- 기대 0
