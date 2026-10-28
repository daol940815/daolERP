-- =====================================================
-- 419_dedupe_card_expenses.sql  (회계 트랙 — 1회성 데이터 정리)
-- 법인카드 10-28 업로드 되돌리기 — 카드계좌 갈림으로 같은 거래가 두 번 들어간 것 (2026-10-28)
--
-- 2차 점검(checks/card_duplicate_check2.sql) 결과
--   · 10-28에 올린 파일은 카드번호 표기가 등록 카드와 달랐다(하나·우리 16자리 전체, 롯데 앞4+뒤3).
--     카드번호 치환(resolveCardNo)이 통합양식 프로파일에만 있어 카드사별 프로파일은 **새 카드계좌 9장**을 만들었고,
--     같은 거래가 다른 카드계좌 밑에 들어가 1차 "엄격 중복" 점검(카드계좌 일치)에 안 잡혔다.
--     (10-28 생성 카드계좌: 롯데 5105373·5105473 / 우리 9500610002300566·5532240012487219·6438 /
--      하나 5376140002062841·5376140002842242·5376140003991535·5531844009883826·9440819002032078·9440819003238781)
--   · 취소 표기도 양식마다 달라(승인 음수 vs 승인 0/취소 양수) 순액 기준으로만 같은 거래다(느슨한 중복 19묶음).
--   · 10-28 행은 표본에서 전부 추천만(pending) — 사람 작업 없음(STEP 1에서 확인).
-- 처리: 10-28에 들어온 행을 전부 지우고, 그날 생긴 카드계좌 중 내역이 남지 않은 것을 지운다.
--   그다음 고친 업로더(치환 전 프로파일 적용 + 취소 표기 통일 + 양식 간 중복 가드)로 같은 파일을
--   다시 올리면 기존에 없는 거래만 들어온다.
-- 가드: 10-28 행에 확정이나 분개가 하나라도 있으면 중단.
-- 1차 점검의 엄격 중복 8묶음(10-23 통합 ↔ 10-28)도 이 삭제로 함께 해소된다.
-- =====================================================

-- ── STEP 1. 드라이런 ──────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM card_expenses WHERE created_at::date = DATE '2026-10-28')                                  AS 지울행,
  (SELECT COALESCE(SUM(approved_amount - cancel_amount), 0) FROM card_expenses WHERE created_at::date = DATE '2026-10-28') AS 지울행_순액,
  (SELECT COUNT(*) FROM card_expenses WHERE created_at::date = DATE '2026-10-28' AND classify_status = 'confirmed')   AS 확정_있음_0이어야,
  (SELECT COUNT(*) FROM journal_entries je WHERE je.source_type = 'card'
     AND je.source_id IN (SELECT id FROM card_expenses WHERE created_at::date = DATE '2026-10-28'))                 AS 분개_있음_0이어야,
  (SELECT string_agg(source_sheet || ' ' || n, ' / ') FROM (
     SELECT source_sheet, COUNT(*) n FROM card_expenses WHERE created_at::date = DATE '2026-10-28' GROUP BY 1) x)  AS 시트별,
  (SELECT COUNT(*) FROM card_accounts WHERE created_at::date = DATE '2026-10-28')                                   AS 지울_카드계좌,
  (SELECT COUNT(*) FROM card_expenses e JOIN card_accounts ca ON ca.id = e.card_account_id
     WHERE ca.created_at::date = DATE '2026-10-28' AND e.created_at::date <> DATE '2026-10-28')                      AS 새계좌에_다른날_행_0이어야;

-- ── STEP 2. 삭제 ───────────────────────────────────────
DO $$
DECLARE v_rows int; v_bad int; v_acc int;
BEGIN
  SELECT COUNT(*) INTO v_bad FROM card_expenses
   WHERE created_at::date = DATE '2026-10-28'
     AND (classify_status = 'confirmed'
          OR EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'card' AND je.source_id = card_expenses.id));
  IF v_bad > 0 THEN RAISE EXCEPTION '10-28 행 중 확정/분개 % 건 — 중단', v_bad; END IF;

  SELECT COUNT(*) INTO v_bad FROM card_expenses e JOIN card_accounts ca ON ca.id = e.card_account_id
   WHERE ca.created_at::date = DATE '2026-10-28' AND e.created_at::date <> DATE '2026-10-28';
  IF v_bad > 0 THEN RAISE EXCEPTION '10-28 생성 카드계좌에 다른 날 행 % 건 — 중단', v_bad; END IF;

  WITH del AS (DELETE FROM card_expenses WHERE created_at::date = DATE '2026-10-28' RETURNING id)
  SELECT COUNT(*) INTO v_rows FROM del;

  WITH del AS (
    DELETE FROM card_accounts ca WHERE ca.created_at::date = DATE '2026-10-28'
      AND NOT EXISTS (SELECT 1 FROM card_expenses e WHERE e.card_account_id = ca.id)
    RETURNING id)
  SELECT COUNT(*) INTO v_acc FROM del;

  RAISE NOTICE '10-28 업로드 되돌림 — 행 % 삭제, 카드계좌 % 삭제', v_rows, v_acc;
END $$;

-- ── STEP 3. 검증 ──────────────────────────────────────
-- 기대: 남은_1028행 0 · 카드계좌 11장(롯데 3·우리 2·하나 6) · 엄격중복 0
SELECT
  (SELECT COUNT(*) FROM card_expenses WHERE created_at::date = DATE '2026-10-28')  AS 남은_1028행,
  (SELECT COUNT(*) FROM card_accounts)                                              AS 카드계좌수,
  (SELECT COUNT(*) FROM (
     SELECT 1 FROM card_expenses
     GROUP BY card_account_id, tx_date, approved_amount, cancel_amount
     HAVING COUNT(*) > 1 AND COUNT(DISTINCT source_sheet) > 1) x)                    AS 남은_엄격중복,
  (SELECT COUNT(*) FROM card_expenses WHERE tx_date >= DATE '2026-06-30')            AS 행수_0630이후;
