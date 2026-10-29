-- =====================================================
-- 421_card_hold_cancels.sql  (회계 트랙 — 1회성 데이터 정리, 재실행 가능)
-- 법인카드 가승인·선승인 보류 해제가 환불(취소금액)로 저장된 행 정정 (2026-10-29)
--
-- 사용자 발견: 롯데 4473 카드에서 취소금액이 먼저 찍히고 실결제가 뒤에 오며, 취소가 결제보다 조금 크다.
-- 원인: 카카오T 택시 등은 탑승 시 예상 요금을 가승인(결제 보류)하고 하차 시 보류를 풀면서 실제 요금을 따로 승인한다.
--   카드사 파일에는 보류 해제가 '취소' 행으로만 온다(보류 승인은 청구가 아니라 목록에 없음). 예상 요금이라 실제보다 크다.
--   통합양식 프로파일만 이것을 금액 0으로 기록했고, 카드사별 프로파일(롯데 취소여부 Y 등)은 취소금액으로 저장해
--   순액이 음수 → 확정되면 역분개로 비용이 줄어든다. 업로더는 모든 양식 공통 규칙으로 고쳤고, 이미 들어간 행을 여기서 정정한다.
-- 대상: 가맹점명에 가승인/선승인이 있고 승인 0 · 취소 > 0 인 행 중, 짝이 되는 보류 승인 행(같은 카드·가맹점·금액, ±3일)이 없는 것.
-- 처리: 취소금액 0 · 부가세 0 · statement_status '가승인 취소' · 해당 행의 분개 삭제(순액 0은 전기 대상이 아님).
--       분류 상태·계정은 그대로 둔다(기록 보존).
-- =====================================================

-- ── STEP 1. 드라이런 ──────────────────────────────────
WITH t AS (
  SELECT e.*
  FROM card_expenses e
  WHERE e.merchant_name ~ '가승인|선승인'
    AND COALESCE(e.approved_amount, 0) = 0 AND COALESCE(e.cancel_amount, 0) > 0
    AND COALESCE(e.statement_status, '') <> '가승인 취소'
    AND NOT EXISTS (
      SELECT 1 FROM card_expenses a
      WHERE a.card_account_id = e.card_account_id AND a.merchant_name = e.merchant_name
        AND a.approved_amount = e.cancel_amount
        AND a.tx_date BETWEEN e.tx_date - 3 AND e.tx_date + 3)
)
SELECT
  (SELECT COUNT(*) FROM t)                                  AS 대상행,
  (SELECT COALESCE(SUM(cancel_amount), 0) FROM t)           AS 취소금액합,
  (SELECT COUNT(*) FROM t WHERE classify_status = 'confirmed') AS 확정됨,
  (SELECT COUNT(*) FROM journal_entries je WHERE je.source_type = 'card' AND je.source_id IN (SELECT id FROM t)) AS 역분개_있음,
  (SELECT string_agg(DISTINCT ca.card_company || ' ' || right(ca.card_number, 4), ', ')
     FROM t JOIN card_accounts ca ON ca.id = t.card_account_id)                             AS 카드,
  (SELECT MIN(tx_date) || ' ~ ' || MAX(tx_date) FROM t)     AS 기간;

-- 1-b. 표본 — 보류 해제와 그 뒤 실결제가 어떻게 짝이 되는지 (같은 카드·같은 날 택시 결제)
WITH t AS (
  SELECT e.* FROM card_expenses e
  WHERE e.merchant_name ~ '가승인|선승인' AND COALESCE(e.approved_amount, 0) = 0 AND COALESCE(e.cancel_amount, 0) > 0
    AND COALESCE(e.statement_status, '') <> '가승인 취소'
)
SELECT t.tx_date AS 보류일, t.tx_time AS 보류시각, t.merchant_name AS 보류가맹점, t.cancel_amount AS 보류금액,
       r.tx_time AS 결제시각, r.merchant_name AS 결제가맹점, r.approved_amount AS 결제금액
FROM t LEFT JOIN LATERAL (
  SELECT r.* FROM card_expenses r
  WHERE r.card_account_id = t.card_account_id AND r.tx_date = t.tx_date AND r.approved_amount > 0
    AND r.merchant_name ~ '택시|카카오' AND r.merchant_name !~ '가승인|선승인'
  ORDER BY abs(r.approved_amount - t.cancel_amount) LIMIT 1) r ON true
ORDER BY t.tx_date DESC, t.tx_time DESC LIMIT 15;

-- ── STEP 2. 정정 ───────────────────────────────────────
DO $$
DECLARE v_rows int; v_je int;
BEGIN
  CREATE TEMP TABLE _hold ON COMMIT DROP AS
  SELECT e.id FROM card_expenses e
  WHERE e.merchant_name ~ '가승인|선승인'
    AND COALESCE(e.approved_amount, 0) = 0 AND COALESCE(e.cancel_amount, 0) > 0
    AND COALESCE(e.statement_status, '') <> '가승인 취소'
    AND NOT EXISTS (
      SELECT 1 FROM card_expenses a
      WHERE a.card_account_id = e.card_account_id AND a.merchant_name = e.merchant_name
        AND a.approved_amount = e.cancel_amount
        AND a.tx_date BETWEEN e.tx_date - 3 AND e.tx_date + 3);

  WITH del AS (DELETE FROM journal_entries je WHERE je.source_type = 'card' AND je.source_id IN (SELECT id FROM _hold) RETURNING id)
  SELECT COUNT(*) INTO v_je FROM del;

  WITH upd AS (
    UPDATE card_expenses SET cancel_amount = 0, tax_amount = 0, statement_status = '가승인 취소'
    WHERE id IN (SELECT id FROM _hold) RETURNING id)
  SELECT COUNT(*) INTO v_rows FROM upd;

  RAISE NOTICE '가승인 보류 해제 정정 — 행 % 건 (취소 0으로), 역분개 % 건 삭제', v_rows, v_je;
END $$;

-- ── STEP 3. 검증 ──────────────────────────────────────
-- 기대: 남은_대상 0 · 고아_카드분개 0
SELECT
  (SELECT COUNT(*) FROM card_expenses e
    WHERE e.merchant_name ~ '가승인|선승인' AND COALESCE(e.approved_amount, 0) = 0 AND COALESCE(e.cancel_amount, 0) > 0
      AND COALESCE(e.statement_status, '') <> '가승인 취소'
      AND NOT EXISTS (SELECT 1 FROM card_expenses a WHERE a.card_account_id = e.card_account_id AND a.merchant_name = e.merchant_name
                        AND a.approved_amount = e.cancel_amount AND a.tx_date BETWEEN e.tx_date - 3 AND e.tx_date + 3)) AS 남은_대상,
  (SELECT COUNT(*) FROM card_expenses WHERE statement_status = '가승인 취소')                                        AS 가승인취소_행,
  (SELECT COUNT(*) FROM journal_entries je WHERE je.source_type = 'card'
     AND NOT EXISTS (SELECT 1 FROM card_expenses e WHERE e.id = je.source_id))                                       AS 고아_카드분개;
