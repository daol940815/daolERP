-- =====================================================
-- 514_payment_match_prepay.sql  (주문시스템 트랙 — 선결제 사용)
-- 2026-11-05 사용자 확정 (시안 docs/mockups/선결제_사용_시안.html, "5가지 모두 가안")
--
-- 선결제 사용 = 주문 결제 수단 하나. 사용 1건은
--   ① erp_prepayments 차감(deduction) 1행 (order_id 연결) +
--   ② erp_payment_matches 1행 (source_type 'prepay', source_id = ①의 id, 같은 금액)
-- 으로 기록한다. ②가 있어 표준 미수(v_erp_order_receivable 406·416, lib/receivable.ts)가
-- 통장·카드와 똑같이 차감한다 — 미수 규칙(뷰)은 고치지 않는다.
-- 회계 분개(journal_entries)는 매칭 기록을 읽지 않으므로 영향 없음.
--
-- 바뀌는 것: erp_payment_matches.source_type CHECK에 'prepay' 추가 (021: bank|card|cash)
-- 데이터 변경 없음
-- =====================================================

DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'erp_payment_matches' AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%source_type%'
  LOOP
    EXECUTE format('ALTER TABLE erp_payment_matches DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE erp_payment_matches
  ADD CONSTRAINT erp_payment_matches_source_type_check
  CHECK (source_type IN ('bank', 'card', 'cash', 'prepay'));

COMMENT ON COLUMN erp_payment_matches.source_type IS
  'bank=통장 입금(transactions) / card=카드 승인(card_sales) / cash=현금영수증 / prepay=선결제 사용(erp_prepayments 차감 행, 514)';

-- ── 검증 (실행 후) ───────────────────────────────────────
-- 기대: 선결제허용_기대1 = 1 / 기존매칭_건수 = 실행 전과 동일(데이터 변경 없음)
SELECT
  (SELECT COUNT(*) FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'erp_payment_matches' AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%prepay%') AS 선결제허용_기대1,
  (SELECT COUNT(*) FROM erp_payment_matches) AS 기존매칭_건수;
