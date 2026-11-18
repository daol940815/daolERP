-- =====================================================
-- 1306_payment_match_refund.sql  (결제처리 트랙 — docs/payment-track.md)
-- 계좌이체 환불 매칭 — 수금 매칭에 마이너스 금액 허용  (2026-11-18 사용자 승인: 취소 2단계)
--
-- 계산서 없이 이체로 받아 "계좌이체"로 기록한 건을 되돌릴 때, 우리 통장의 환불 출금을 그 취소 줄에 매칭한다.
--   입금 매칭(+)은 그대로 두고, 환불 출금을 같은 주문에 마이너스 금액으로 붙인다 → 주문 수금 합계가 줄어 미수가 되살아난다.
--   (입금 매칭을 풀지 않는 이유: 풀면 그 입금이 '기록 없는 입금'으로 다시 떠서 다른 주문에 잘못 붙을 수 있다)
-- 바뀌는 것: erp_payment_matches.amount 제약 amount > 0 → amount <> 0. 표준 미수 뷰는 SUM 이라 그대로 동작한다.
-- 마이너스 행은 source_type 'bank', source_id = 출금 거래, record_id = 결제 기록의 취소 줄.
-- 원본(transactions)은 건드리지 않는다. 재실행 안전.
-- =====================================================

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'erp_payment_matches' AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%amount%' AND pg_get_constraintdef(con.oid) NOT ILIKE '%source_type%'
  LOOP
    EXECUTE format('ALTER TABLE erp_payment_matches DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE erp_payment_matches ADD CONSTRAINT erp_payment_matches_amount_check CHECK (amount <> 0);

-- ── 검증 (실행 뒤 결과를 알려 주세요) ─────────────────────
-- ① 금액 제약이 amount <> 0 한 개인지
SELECT con.conname, pg_get_constraintdef(con.oid) AS def FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'erp_payment_matches' AND con.contype = 'c' AND pg_get_constraintdef(con.oid) ILIKE '%amount%';
-- ② 기존 데이터 영향 없음 — 마이너스 매칭 0건, 전체 건수
SELECT count(*) FILTER (WHERE amount < 0) AS negative_matches, count(*) AS total_matches FROM erp_payment_matches;
