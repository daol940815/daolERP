-- =====================================================
-- 511_order_cancel_reissue.sql
-- 주문 수정·삭제 방식 변경 (홈택스 방식 취소·재등록) — 2026-08-25 사용자 확정
--
-- 1) erp_orders 취소·재등록 컬럼:
--    - 삭제는 물리 삭제 폐지 → 취소 처리(canceled_at)로 상계 (원본 보존)
--    - 익일 이후 수정 = 전체 취소 + 프리필 재등록 (원본↔재등록 상호 링크)
--    - last_edited_at: 당일 직접 수정 표시 (목록 '수정됨' 배지)
-- 2) erp_order_edit_logs: 변경 로그 (누가·언제·무엇을 어떻게) —
--    당일 수정의 기본정보 변경·품목 취소/추가, 취소·재등록 이력 기록.
--    주문 상세 하단 접이식 '변경 이력' 섹션에서 표시.
--
-- 실행: Supabase SQL 편집기 (사용자 직접 실행)
-- =====================================================

ALTER TABLE erp_orders
  ADD COLUMN IF NOT EXISTS canceled_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canceled_by            UUID REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason          TEXT,
  ADD COLUMN IF NOT EXISTS reissued_to_order_id   UUID REFERENCES erp_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reissued_from_order_id UUID REFERENCES erp_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_edited_at         TIMESTAMPTZ;

COMMENT ON COLUMN erp_orders.canceled_at            IS '주문 취소 시각 — 취소 주문은 매출·미수 집계 제외 (물리 삭제 없음, 상계 효과)';
COMMENT ON COLUMN erp_orders.canceled_by            IS '취소한 직원';
COMMENT ON COLUMN erp_orders.cancel_reason          IS '취소 사유 (재등록이면 ''재등록'')';
COMMENT ON COLUMN erp_orders.reissued_to_order_id   IS '이 주문을 취소하고 재등록한 새 주문';
COMMENT ON COLUMN erp_orders.reissued_from_order_id IS '이 주문이 재등록으로 만들어진 원본 주문';
COMMENT ON COLUMN erp_orders.last_edited_at         IS '당일 직접 수정 최종 시각 — 목록 ''수정됨'' 표시';

CREATE INDEX IF NOT EXISTS idx_erp_orders_canceled
  ON erp_orders(canceled_at) WHERE canceled_at IS NOT NULL;

-- ── 변경 로그 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_order_edit_logs (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID         NOT NULL REFERENCES erp_orders(id) ON DELETE CASCADE,
  employee_id   UUID         REFERENCES employees(id) ON DELETE SET NULL,
  employee_name VARCHAR(100),                -- 직원 이름 스냅샷 (마스터 변경과 무관하게 보존)
  field_label   VARCHAR(100) NOT NULL,       -- 예: '주문처' / '담당자' / '품목 추가'
  before_text   TEXT,
  after_text    TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_erp_order_edit_logs_order
  ON erp_order_edit_logs(order_id, created_at);

COMMENT ON TABLE erp_order_edit_logs IS
  '주문 변경 로그 (511) — 당일 직접 수정의 필드별 변경 전/후, 품목 취소·추가, 취소·재등록 이력';

-- ── 검증 (실행 후 결과 보고용) ─────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'erp_orders'
      AND column_name IN ('canceled_at', 'canceled_by', 'cancel_reason',
                          'reissued_to_order_id', 'reissued_from_order_id', 'last_edited_at')) AS 주문컬럼_기대6,
  (SELECT count(*) FROM information_schema.tables
    WHERE table_name = 'erp_order_edit_logs') AS 로그테이블_기대1;
