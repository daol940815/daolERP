-- =====================================================
-- 1305_payment_record_cancel.sql  (결제처리 트랙 — docs/payment-track.md)
-- 결제 기록 취소 · 사유  (2026-11-18 사용자 확정 — 시안 docs/mockups/결제기록_취소_시안.html)
--
-- 취소 = 실제로 실행한 결제(카드 승인 · 계산서 발행 · 이체)를 되돌린 것. 삭제 = 잘못 적은 기록을 없애는 것.
--   취소는 원 기록을 지우지 않고 "취소 줄"(cancel_of = 원 기록)로 남긴다. 부분 취소 가능(한 기록에 여러 줄).
--   2차에서 취소도 원본과 매칭한다 — 카드 = 카드 매출의 취소 행, 계산서 = 취소 계산서(마이너스).
--   취소 계산서는 주문에 마이너스 금액으로 연결된다(원 계산서 · 취소 계산서 · 재발행 계산서가 모두 주문에 남는다).
-- 사유: 취소 · 삭제 · 수정에 사유(항목 코드 + 직접 입력)를 남긴다.
-- 원본(card_sales · tax_invoices · transactions)은 건드리지 않는다. 재실행 안전.
-- =====================================================

-- ① 결제 기록: 취소 줄 · 사유
ALTER TABLE order_payment_records ADD COLUMN IF NOT EXISTS cancel_of   UUID REFERENCES order_payment_records(id) ON DELETE CASCADE;
ALTER TABLE order_payment_records ADD COLUMN IF NOT EXISTS reason_code TEXT;
ALTER TABLE order_payment_records ADD COLUMN IF NOT EXISTS reason_text TEXT;
CREATE INDEX IF NOT EXISTS idx_opr_cancel_of ON order_payment_records(cancel_of) WHERE cancel_of IS NOT NULL;

COMMENT ON COLUMN order_payment_records.cancel_of   IS '취소 줄이면 원 기록 id. amount = 취소 금액(양수로 저장), pay_date = 취소일';
COMMENT ON COLUMN order_payment_records.reason_code IS '취소 줄: 취소 사유 항목 / 원 기록: 마지막 수정 사유 항목 (lib/payment-reasons.ts)';
COMMENT ON COLUMN order_payment_records.reason_text IS '사유 표시 문구(항목 이름 또는 기타 직접 입력)';

-- ② 이력: 사유 칸 + 동작에 cancel(취소 기록) · cancel_confirm(취소 매칭) 추가
ALTER TABLE order_payment_record_logs ADD COLUMN IF NOT EXISTS reason_code TEXT;
ALTER TABLE order_payment_record_logs ADD COLUMN IF NOT EXISTS reason_text TEXT;
ALTER TABLE order_payment_record_logs DROP CONSTRAINT IF EXISTS order_payment_record_logs_action_check;
ALTER TABLE order_payment_record_logs ADD CONSTRAINT order_payment_record_logs_action_check
  CHECK (action IN ('create', 'update', 'delete', 'confirm', 'release', 'cancel', 'cancel_confirm'));

-- ③ 주문 ↔ 계산서 연결: 취소 계산서(마이너스) 허용 + 어느 취소 기록 · 어느 원 계산서의 취소인지
ALTER TABLE erp_order_invoices DROP CONSTRAINT IF EXISTS erp_order_invoices_amount_check;
ALTER TABLE erp_order_invoices ADD CONSTRAINT erp_order_invoices_amount_check CHECK (amount <> 0);
ALTER TABLE erp_order_invoices ADD COLUMN IF NOT EXISTS cancel_record_id   UUID REFERENCES order_payment_records(id) ON DELETE SET NULL;
ALTER TABLE erp_order_invoices ADD COLUMN IF NOT EXISTS cancels_invoice_id UUID REFERENCES tax_invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_eoi_cancels ON erp_order_invoices(cancels_invoice_id) WHERE cancels_invoice_id IS NOT NULL;

COMMENT ON COLUMN erp_order_invoices.cancel_record_id   IS '취소 계산서 연결(amount < 0)을 만든 결제 기록의 취소 줄';
COMMENT ON COLUMN erp_order_invoices.cancels_invoice_id IS '이 취소 계산서가 취소한 원 계산서 — 원 계산서는 연결 동기화(입금 넘기기) 대상에서 빠진다';

-- ── 검증 (실행 뒤 결과를 알려 주세요) ─────────────────────
-- ① 새 칸 수 — 기대 7
SELECT count(*) AS new_columns FROM information_schema.columns
WHERE (table_name = 'order_payment_records'     AND column_name IN ('cancel_of', 'reason_code', 'reason_text'))
   OR (table_name = 'order_payment_record_logs' AND column_name IN ('reason_code', 'reason_text'))
   OR (table_name = 'erp_order_invoices'        AND column_name IN ('cancel_record_id', 'cancels_invoice_id'));
-- ② 제약 두 개가 새 조건으로 바뀌었는지 — amount <> 0 / action 목록에 cancel 포함
SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
WHERE conname IN ('erp_order_invoices_amount_check', 'order_payment_record_logs_action_check');
-- ③ 기존 데이터 영향 없음 — 취소 줄 0 · 마이너스 연결 0
SELECT (SELECT count(*) FROM order_payment_records WHERE cancel_of IS NOT NULL) AS cancel_lines,
       (SELECT count(*) FROM erp_order_invoices WHERE amount < 0) AS negative_links;
