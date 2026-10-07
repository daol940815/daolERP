-- =====================================================
-- 410_cleanup_misuploaded_bank_file.sql  (회계 트랙 — 1회성 데이터 정리)
-- 구버전 업로더로 잘못 들어간 통합계좌 파일 1건 삭제 (2026-10-07)
--
-- 경위: 통합계좌 업로드 코드가 main에 배포되기 전에 파일을 올려,
--   1,356건이 계좌 없음(bank_account_id NULL)으로 들어갔다.
--   upload_logs.id = f74e7770-2534-4083-8f12-21ae53775903
--   파일 = 입출금 거래내역 조회_20261007_163123.xls, 2026-10-07 09:11 UTC
-- 점검(upload_outcome_check.sql) 결과: 확정 0 · 검토 0 · 분개 0 · 가짜 계좌 0.
--   192건은 정상 계좌에 이미 있는 행과 내용이 같은 중복.
-- 조치: 그 업로드의 거래 1,356건과 업로드 이력 1건을 지운다. 다른 행은 손대지 않는다.
--   이력까지 지우는 이유 — 같은 파일을 새 업로더로 다시 올릴 때 파일 해시로
--   이 이력을 재사용하지 않게 하기 위해서.
-- =====================================================

-- ── STEP 1. 드라이런 (읽기 전용) ─────────────────────────
-- 기대: rows = 1356, no_account = 1356, touched = 0, refs 전부 0
WITH tgt AS (
  SELECT id FROM transactions
  WHERE upload_log_id = 'f74e7770-2534-4083-8f12-21ae53775903'
)
SELECT
  (SELECT COUNT(*) FROM tgt)                                                   AS rows,
  (SELECT COUNT(*) FROM transactions t JOIN tgt ON tgt.id = t.id
    WHERE t.bank_account_id IS NULL)                                           AS no_account,
  (SELECT COUNT(*) FROM transactions t JOIN tgt ON tgt.id = t.id
    WHERE t.status <> 'pending' OR t.confirmed_account_id IS NOT NULL)         AS touched,
  (SELECT COUNT(*) FROM journal_entries je
    WHERE je.source_type = 'bank' AND je.source_id IN (SELECT id FROM tgt))    AS ref_journal,
  (SELECT COUNT(*) FROM erp_payment_matches m
    WHERE m.source_type = 'bank' AND m.source_id IN (SELECT id FROM tgt))      AS ref_erp_match,
  (SELECT COUNT(*) FROM tax_invoice_payments p
    WHERE p.transaction_id IN (SELECT id FROM tgt))                            AS ref_invoice_pay,
  (SELECT COUNT(*) FROM transactions t JOIN tgt ON tgt.id = t.id
    WHERE t.transfer_pair_id IS NOT NULL)                                      AS ref_transfer_pair,
  (SELECT COUNT(*) FROM upload_logs
    WHERE id = 'f74e7770-2534-4083-8f12-21ae53775903')                         AS log_rows;

-- ── STEP 2. 삭제 (STEP 1이 기대와 같을 때만) ──────────────
-- 참조가 하나라도 있으면 중단되도록 가드를 건다.
DO $$
DECLARE
  v_log  CONSTANT uuid := 'f74e7770-2534-4083-8f12-21ae53775903';
  v_rows int;
  v_bad  int;
BEGIN
  SELECT COUNT(*) INTO v_rows FROM transactions WHERE upload_log_id = v_log;
  IF v_rows <> 1356 THEN
    RAISE EXCEPTION '대상 건수가 1356이 아님: % — 중단', v_rows;
  END IF;

  SELECT COUNT(*) INTO v_bad FROM transactions
   WHERE upload_log_id = v_log
     AND (bank_account_id IS NOT NULL OR status <> 'pending'
          OR confirmed_account_id IS NOT NULL OR transfer_pair_id IS NOT NULL);
  IF v_bad > 0 THEN
    RAISE EXCEPTION '계좌 지정·확정·이체쌍 행 % 건 — 중단', v_bad;
  END IF;

  SELECT COUNT(*) INTO v_bad FROM journal_entries
   WHERE source_type = 'bank'
     AND source_id IN (SELECT id FROM transactions WHERE upload_log_id = v_log);
  IF v_bad > 0 THEN RAISE EXCEPTION '분개 참조 % 건 — 중단', v_bad; END IF;

  SELECT COUNT(*) INTO v_bad FROM erp_payment_matches
   WHERE source_type = 'bank'
     AND source_id IN (SELECT id FROM transactions WHERE upload_log_id = v_log);
  IF v_bad > 0 THEN RAISE EXCEPTION '수금 매칭 참조 % 건 — 중단', v_bad; END IF;

  SELECT COUNT(*) INTO v_bad FROM tax_invoice_payments
   WHERE transaction_id IN (SELECT id FROM transactions WHERE upload_log_id = v_log);
  IF v_bad > 0 THEN RAISE EXCEPTION '계산서 지급 참조 % 건 — 중단', v_bad; END IF;

  DELETE FROM transactions WHERE upload_log_id = v_log;
  DELETE FROM upload_logs  WHERE id = v_log;
  RAISE NOTICE '삭제 완료: 거래 % 건, 업로드 이력 1건', v_rows;
END $$;

-- ── STEP 3. 검증 (실행 후) ──────────────────────────────
-- 기대: remaining_rows = 0, remaining_log = 0,
--       no_account_total = 0 (원래 계좌 미지정 거래가 없었으므로),
--       기간내_정상거래 = 192 (정상 계좌의 기존 행은 그대로)
SELECT
  (SELECT COUNT(*) FROM transactions
    WHERE upload_log_id = 'f74e7770-2534-4083-8f12-21ae53775903')              AS remaining_rows,
  (SELECT COUNT(*) FROM upload_logs
    WHERE id = 'f74e7770-2534-4083-8f12-21ae53775903')                         AS remaining_log,
  (SELECT COUNT(*) FROM transactions WHERE bank_account_id IS NULL)            AS no_account_total,
  (SELECT COUNT(*) FROM transactions
    WHERE source = 'bank' AND tx_date BETWEEN DATE '2026-07-14' AND DATE '2026-10-03') AS 기간내_정상거래;
