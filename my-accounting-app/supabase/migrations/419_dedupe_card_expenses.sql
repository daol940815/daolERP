-- =====================================================
-- 419_dedupe_card_expenses.sql  (회계 트랙 — 1회성 데이터 정리, 재실행 가능)
-- 법인카드 사용내역 — 통합양식과 카드사별 파일로 두 번 들어간 같은 거래 정리 (2026-10-28)
--
-- 같은 거래 판정(엄격): 카드계좌 · 이용일 · 승인금액 · 취소금액이 같고 시트(양식)가 다른 행.
-- 남길 행 우선순위: ① 확정 + 분개 있음 ② 확정 ③ 먼저 올라온 행(created_at). 나머지를 지운다.
-- 안전장치: 지울 행에 확정 상태나 분개가 있으면 그 묶음은 건드리지 않고 보고한다(사람 판단).
--   묶음에 같은 시트 행이 2개 이상(같은 날 같은 금액 두 번 긁음 + 다른 양식 1개 등)이면 역시 건너뛴다.
-- 1차 점검(2026-10-28): 8묶음 16행 378,799 — 전부 통합양식(10-23) 행이 확정+분개, 카드사별(10-28) 행이 추천만.
-- 느슨한 중복(취소 표기 차이 등)은 checks/card_duplicate_check2.sql 결과를 보고 따로 정한다.
-- =====================================================

-- ── STEP 1. 드라이런 ──────────────────────────────────
WITH g AS (
  SELECT card_account_id, tx_date, approved_amount, cancel_amount
  FROM card_expenses
  GROUP BY card_account_id, tx_date, approved_amount, cancel_amount
  HAVING COUNT(*) > 1 AND COUNT(DISTINCT source_sheet) > 1 AND COUNT(*) = COUNT(DISTINCT source_sheet)
),
r AS (
  SELECT e.id, e.card_account_id, e.tx_date, e.approved_amount, e.cancel_amount, e.source_sheet, e.classify_status, e.created_at,
         EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'card' AND je.source_id = e.id) AS has_journal,
         ROW_NUMBER() OVER (PARTITION BY e.card_account_id, e.tx_date, e.approved_amount, e.cancel_amount
                            ORDER BY (e.classify_status = 'confirmed' AND EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'card' AND je.source_id = e.id)) DESC,
                                     (e.classify_status = 'confirmed') DESC, e.created_at, e.id) AS rk
  FROM card_expenses e JOIN g USING (card_account_id, tx_date, approved_amount, cancel_amount)
)
SELECT
  (SELECT COUNT(*) FROM g)                                                         AS 묶음수,
  (SELECT COUNT(*) FROM r WHERE rk > 1)                                            AS 지울행,
  (SELECT COALESCE(SUM(approved_amount - cancel_amount), 0) FROM r WHERE rk > 1)   AS 지울행_순액,
  (SELECT COUNT(*) FROM r WHERE rk > 1 AND (classify_status = 'confirmed' OR has_journal)) AS 지울행중_확정또는분개_있음_건너뜀,
  (SELECT string_agg(DISTINCT source_sheet, ', ') FROM r WHERE rk > 1)             AS 지울행_시트;

-- ── STEP 2. 삭제 ───────────────────────────────────────
DO $$
DECLARE v_del int; v_skip int;
BEGIN
  WITH g AS (
    SELECT card_account_id, tx_date, approved_amount, cancel_amount
    FROM card_expenses
    GROUP BY card_account_id, tx_date, approved_amount, cancel_amount
    HAVING COUNT(*) > 1 AND COUNT(DISTINCT source_sheet) > 1 AND COUNT(*) = COUNT(DISTINCT source_sheet)
  ),
  r AS (
    SELECT e.id, e.card_account_id, e.tx_date, e.approved_amount, e.cancel_amount, e.classify_status,
           EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'card' AND je.source_id = e.id) AS has_journal,
           ROW_NUMBER() OVER (PARTITION BY e.card_account_id, e.tx_date, e.approved_amount, e.cancel_amount
                              ORDER BY (e.classify_status = 'confirmed' AND EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'card' AND je.source_id = e.id)) DESC,
                                       (e.classify_status = 'confirmed') DESC, e.created_at, e.id) AS rk
    FROM card_expenses e JOIN g USING (card_account_id, tx_date, approved_amount, cancel_amount)
  ),
  bad AS (   -- 지울 쪽에 확정/분개가 있는 묶음은 통째로 제외
    SELECT DISTINCT card_account_id, tx_date, approved_amount, cancel_amount FROM r
    WHERE rk > 1 AND (classify_status = 'confirmed' OR has_journal)
  ),
  del AS (
    DELETE FROM card_expenses e
    USING r
    WHERE e.id = r.id AND r.rk > 1
      AND NOT EXISTS (SELECT 1 FROM bad b WHERE b.card_account_id = r.card_account_id AND b.tx_date = r.tx_date
                        AND b.approved_amount = r.approved_amount AND b.cancel_amount = r.cancel_amount)
    RETURNING e.id
  )
  SELECT (SELECT COUNT(*) FROM del), (SELECT COUNT(*) FROM bad) INTO v_del, v_skip;
  RAISE NOTICE '법인카드 중복 정리 — 삭제 % 행, 사람 판단으로 남긴 묶음 %', v_del, v_skip;
END $$;

-- ── STEP 3. 검증 ──────────────────────────────────────
-- 기대: 남은_엄격중복 0 (건너뛴 묶음이 있으면 그 수만큼)
SELECT
  (SELECT COUNT(*) FROM (
     SELECT 1 FROM card_expenses
     GROUP BY card_account_id, tx_date, approved_amount, cancel_amount
     HAVING COUNT(*) > 1 AND COUNT(DISTINCT source_sheet) > 1) x)                    AS 남은_엄격중복,
  (SELECT COUNT(*) FROM card_expenses WHERE tx_date >= DATE '2026-06-30')            AS 행수_0630이후,
  (SELECT COALESCE(SUM(approved_amount - cancel_amount), 0) FROM card_expenses WHERE tx_date >= DATE '2026-06-30') AS 순액_0630이후;
