-- =====================================================
-- 1302_link_sync_and_invoice_partial.sql  (결제처리 트랙 + 회계 트랙 계산서 상태 — docs/payment-track.md · docs/accounting-track.md)
-- 주문 · 계산서 · 통장 입금 연결 동기화 + 계산서 "부분 확인" 상태  (2026-11-17 사용자 승인 "권장안대로 진행")
--
-- 무엇을 하나 (칸 추가 · 허용 값 추가만 — 기존 행의 값은 하나도 바꾸지 않는다. 재실행 안전)
--   1) erp_payment_matches.from_invoice_id
--        이 수금이 "계산서에 붙은 입금"에서 자동으로 넘어온 것이면 그 계산서. NULL = 사람이 직접 붙인 수금.
--        계산서가 지워지면 넘어온 수금도 함께 지워진다(ON DELETE CASCADE).
--   2) tax_invoice_payments.from_order_sync
--        이 계산서 입금이 "주문에 붙인 수금"에서 자동으로 넘어온 것이면 true. (주문 → 계산서 방향은 2단계에서 사용)
--   3) tax_invoices.payment_status 에 'partial'(부분 확인) 허용 — 현금영수증(425)과 같은 3단계
--   4) tax_invoices.payment_manual — 입금 연결과 무관하게 사람이 "확인됨"으로 바꾼 계산서 표시.
--        true 인 계산서는 입금을 붙이거나 풀어도 "확인됨"이 지워지지 않는다.
--
-- 기존 계산서의 상태 보정(일부만 입금된 미확인 → 부분 확인 등)은 여기서 하지 않는다 —
--   supabase/checks/invoice_status_backfill_check.sql 로 건수를 먼저 보고, 승인 후 1303 으로 실행한다.
-- =====================================================

ALTER TABLE erp_payment_matches
  ADD COLUMN IF NOT EXISTS from_invoice_id UUID REFERENCES tax_invoices(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_erp_matches_from_invoice ON erp_payment_matches(from_invoice_id) WHERE from_invoice_id IS NOT NULL;
COMMENT ON COLUMN erp_payment_matches.from_invoice_id IS
  '계산서에 붙은 입금에서 자동으로 넘어온 수금이면 그 계산서(1302). NULL = 직접 붙인 수금. 넘어온 수금은 계산서 쪽에서만 풀 수 있다.';

ALTER TABLE tax_invoice_payments
  ADD COLUMN IF NOT EXISTS from_order_sync BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN tax_invoice_payments.from_order_sync IS
  '주문에 붙인 수금에서 자동으로 넘어온 계산서 입금이면 true(1302). false = 회계가 직접 붙인 입금.';

ALTER TABLE tax_invoices
  ADD COLUMN IF NOT EXISTS payment_manual BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN tax_invoices.payment_manual IS
  '입금 연결과 무관하게 사람이 확인됨으로 바꾼 계산서(1302). true 면 입금 합계로 상태를 다시 계산하지 않는다.';

-- payment_status 허용 값에 partial 추가 (기존 CHECK 이름이 환경마다 다를 수 있어 정의로 찾아 교체)
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'tax_invoices'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%payment_status%'
  LOOP
    EXECUTE format('ALTER TABLE tax_invoices DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE tax_invoices
    ADD CONSTRAINT tax_invoices_payment_status_check CHECK (payment_status IN ('matched', 'partial', 'unmatched'));
END $$;

-- ── 검증 (실행 후 결과를 알려주세요) ──────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'erp_payment_matches'  AND column_name = 'from_invoice_id') AS "수금_출처칸_기대1",
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tax_invoice_payments' AND column_name = 'from_order_sync') AS "계산서입금_출처칸_기대1",
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tax_invoices'         AND column_name = 'payment_manual')  AS "수동확인칸_기대1",
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'tax_invoices_payment_status_check')                      AS "상태_허용값(partial_포함)",
  (SELECT count(*) FROM erp_payment_matches WHERE from_invoice_id IS NOT NULL)                                                   AS "넘어온_수금_기대0",
  (SELECT count(*) FROM tax_invoices WHERE payment_status = 'partial')                                                           AS "부분확인_기대0",
  (SELECT count(*) FROM tax_invoices WHERE payment_status = 'matched')                                                           AS "확인됨_변동없음",
  (SELECT count(*) FROM tax_invoices WHERE payment_status = 'unmatched')                                                         AS "미확인_변동없음";
