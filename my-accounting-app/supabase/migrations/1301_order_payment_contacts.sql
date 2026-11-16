-- =====================================================
-- 1301_order_payment_contacts.sql  (결제처리 트랙 — docs/payment-track.md, 3단계)
-- 결제 안내 연락 기록 (2026-11-16 사용자 승인 "시안대로 진행해줘")
--
-- 영업지원팀이 결제 안내 · 수금 독촉으로 연락한 내용을 주문 단위로 남긴다.
--   결제 확인 › 결제 안내 대상 탭의 "연락 기록", 주문 상세 결제 내역에 같은 기록이 보인다.
--   입금 약속일(promise_date)이 지나면 "약속일 지남"으로 표시된다.
-- 주문 · 결제 원본은 건드리지 않는다. 재실행 안전.
-- =====================================================

CREATE TABLE IF NOT EXISTS order_payment_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES erp_orders(id) ON DELETE CASCADE,
  contact_date    DATE NOT NULL,
  method          TEXT NOT NULL CHECK (method IN ('phone', 'sms', 'email', 'visit', 'etc')),   -- 전화 · 문자 · 메일 · 방문 · 기타
  memo            TEXT,
  promise_date    DATE,                                   -- 고객이 약속한 입금일 (선택)
  created_by      UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opc_order ON order_payment_contacts(order_id, contact_date DESC, created_at DESC);

ALTER TABLE order_payment_contacts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE order_payment_contacts IS
  '결제 안내 · 수금 독촉 연락 기록 (주문 단위). 결제 확인 › 결제 안내 대상 탭에서 입력.';

-- ── 검증 (실행 후 결과를 알려주세요) ──────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'order_payment_contacts') AS "테이블_기대1",
  (SELECT count(*) FROM order_payment_contacts)                                                AS "연락기록_건수_기대0";
