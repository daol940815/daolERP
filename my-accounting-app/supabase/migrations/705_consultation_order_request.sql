-- =====================================================
-- 705_consultation_order_request.sql  (상담 · 업무일지 트랙 번호 — 주문 트랙 세션에서 작성, 두 트랙 문서에 기록)
-- 2026-11-05 사용자 확정 (시안 docs/mockups/주문진행요청_시안.html)
--
-- 상담일지 "주문 진행 요청": 상담만 하고 주문 입력은 다른 직원에게 맡긴다.
--  - 담당자 = 전 직원 중 1명 · 요청받은 직원은 주문 전환만 가능(상담 수정 불가)
--  - 상담이 주문으로 전환되면(status '주문전환') 요청은 자동 완료 — 별도 완료 상태 없음
--  - 주문의 다올직원 = 입력한 사람, 상담자 = 요청한 사람(상담 작성자)
--  - 아르바이트에게는 마스터 연결된 상담만 요청 가능(앱에서 검사)
--  - 요청 다음 날 아침 09:00에 미처리 건 PC 알림 1회 (order_reminded_at)
-- 데이터 변경 없음 (컬럼 추가만)
-- =====================================================

ALTER TABLE erp_consultations
  ADD COLUMN IF NOT EXISTS order_assignee_id   UUID REFERENCES employees(id) ON DELETE SET NULL,  -- 주문 진행 담당
  ADD COLUMN IF NOT EXISTS order_requested_by  UUID REFERENCES employees(id) ON DELETE SET NULL,  -- 요청한 직원
  ADD COLUMN IF NOT EXISTS order_requested_at  TIMESTAMPTZ,                                        -- 요청 시각
  ADD COLUMN IF NOT EXISTS order_request_memo  TEXT,                                               -- 요청 메모
  ADD COLUMN IF NOT EXISTS order_reminded_at   TIMESTAMPTZ;                                        -- 아침 재알림 보낸 시각

CREATE INDEX IF NOT EXISTS idx_erp_consultations_order_assignee
  ON erp_consultations (order_assignee_id) WHERE order_assignee_id IS NOT NULL;

-- ── 검증 (실행 후) ───────────────────────────────────────
-- 기대: 요청컬럼_기대5 = 5 / 인덱스_기대1 = 1
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'erp_consultations'
      AND column_name IN ('order_assignee_id', 'order_requested_by', 'order_requested_at', 'order_request_memo', 'order_reminded_at')) AS 요청컬럼_기대5,
  (SELECT COUNT(*) FROM pg_indexes
    WHERE tablename = 'erp_consultations' AND indexname = 'idx_erp_consultations_order_assignee') AS 인덱스_기대1;
