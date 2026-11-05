-- =====================================================
-- 420_reset_card_expenses_q3.sql  (회계 트랙 — 1회성 데이터 정리)
-- 법인카드 사용내역 2026-07-01 이후 전부 비우고 카드사별 파일로 다시 올리기 (2026-10-28 사용자 결정)
--
-- 배경: 10-23에 세 양식(통합 226·전체번호 178·하나 10월 52)이 섞여 들어갔고, 통합양식은 우리카드 일부 누락·가맹점명 13자
--   절단, 10-23 행끼리도 같은 거래 겹침 가능(2차 점검 느슨한 중복). 하나씩 가리기보다 기간을 비우고 한 양식으로 다시 올린다.
-- 범위: tx_date >= 2026-07-01. 06-30 행(통합양식 7행)은 남긴다 — 카드사별 '3분기' 파일이 07-01부터라 다시 받을 수 없다.
-- 순서(안전장치):
--   1) 확정 내역을 학습 보관 표(card_expense_learn_archive)에 복사 — 가맹점 학습 추천 재료 보존
--   2) 해당 카드 행의 분개 삭제(journal_lines는 CASCADE) — 원본 없는 분개가 남지 않게
--   3) 카드 행 삭제
--   4) 검증: 07-01 이후 0행, 고아 카드 분개 0, 보관 표 건수
-- 재업로드에 필요한 파일: 롯데 3분기 · 하나 3분기 · **우리 3분기(새로 받아야 함 — 지금 있는 우리 파일은 10월)** ·
--   롯데 10월 · 하나 10월 · 우리 10월(26.10-ing). 통합양식·승인내역상세조회 파일은 올리지 않는다.
-- =====================================================

-- 학습 보관 표 (업로더가 card_expenses 확정 이력과 함께 읽는다)
CREATE TABLE IF NOT EXISTS card_expense_learn_archive (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  merchant_biz_number  TEXT,
  merchant_name        TEXT,
  confirmed_account_id UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tx_date              DATE,
  note                 TEXT,
  archived_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE card_expense_learn_archive IS
  '삭제된 법인카드 확정 내역의 학습용 보관(가맹점 → 확정 계정). 업로더 가맹점 학습이 card_expenses 확정 이력과 합쳐 읽는다. 420에서 생성.';

-- ── STEP 1. 드라이런 ──────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM card_expenses WHERE tx_date >= DATE '2026-07-01')                                        AS 지울행,
  (SELECT COUNT(*) FROM card_expenses WHERE tx_date >= DATE '2026-07-01' AND classify_status = 'confirmed')      AS 그중_확정,
  (SELECT COUNT(*) FROM journal_entries je WHERE je.source_type = 'card'
     AND je.source_id IN (SELECT id FROM card_expenses WHERE tx_date >= DATE '2026-07-01'))                      AS 지울_분개,
  (SELECT COALESCE(SUM(approved_amount - cancel_amount), 0) FROM card_expenses WHERE tx_date >= DATE '2026-07-01') AS 지울행_순액,
  (SELECT COUNT(*) FROM card_expenses WHERE tx_date < DATE '2026-07-01')                                         AS 남는행_0630이전,
  (SELECT string_agg(source_sheet || ' ' || n, ' / ') FROM (
     SELECT source_sheet, COUNT(*) n FROM card_expenses WHERE tx_date >= DATE '2026-07-01' GROUP BY 1) x)        AS 시트별;

-- ── STEP 2. 실행 ───────────────────────────────────────
DO $$
DECLARE v_arch int; v_je int; v_rows int;
BEGIN
  -- 1) 학습 보관
  WITH ins AS (
    INSERT INTO card_expense_learn_archive (merchant_biz_number, merchant_name, confirmed_account_id, tx_date, note)
    SELECT merchant_biz_number, merchant_name, confirmed_account_id, tx_date, '420 — 2026-07-01 이후 재적재 전 보관'
    FROM card_expenses
    WHERE tx_date >= DATE '2026-07-01' AND classify_status = 'confirmed' AND confirmed_account_id IS NOT NULL
    RETURNING id)
  SELECT COUNT(*) INTO v_arch FROM ins;

  -- 2) 분개 삭제 (lines는 CASCADE)
  WITH del AS (
    DELETE FROM journal_entries je
    WHERE je.source_type = 'card'
      AND je.source_id IN (SELECT id FROM card_expenses WHERE tx_date >= DATE '2026-07-01')
    RETURNING id)
  SELECT COUNT(*) INTO v_je FROM del;

  -- 3) 카드 행 삭제
  WITH del AS (DELETE FROM card_expenses WHERE tx_date >= DATE '2026-07-01' RETURNING id)
  SELECT COUNT(*) INTO v_rows FROM del;

  RAISE NOTICE '법인카드 07-01 이후 비움 — 학습 보관 % 건, 분개 % 건 삭제, 카드 행 % 건 삭제', v_arch, v_je, v_rows;
END $$;

-- ── STEP 3. 검증 ──────────────────────────────────────
-- 기대: 남은행_0701이후 0 · 고아_카드분개 0 · 보관 = STEP 1의 그중_확정
SELECT
  (SELECT COUNT(*) FROM card_expenses WHERE tx_date >= DATE '2026-07-01')                   AS 남은행_0701이후,
  (SELECT COUNT(*) FROM journal_entries je WHERE je.source_type = 'card'
     AND NOT EXISTS (SELECT 1 FROM card_expenses e WHERE e.id = je.source_id))              AS 고아_카드분개,
  (SELECT COUNT(*) FROM card_expense_learn_archive)                                          AS 학습보관,
  (SELECT COUNT(*) FROM card_expenses)                                                       AS 남은_카드행_전체,
  (SELECT MAX(tx_date) FROM card_expenses)                                                   AS 마지막_이용일;
