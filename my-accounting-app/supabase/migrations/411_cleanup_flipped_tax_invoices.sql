-- =====================================================
-- 411_cleanup_flipped_tax_invoices.sql  (회계 트랙 — 1회성 데이터 정리)
-- 매입 계산서 파일을 매출 화면에서 올려 방향이 뒤집힌 계산서 삭제 (2026-10-12)
--
-- 증거: tax_invoices.counterparty_biz_number = '701-88-00023'(우리 회사).
--   방향이 뒤집히면 거래처 자리에 공급받는자(= 우리)가 들어간다. 정상 행에서는
--   거래처가 우리 회사일 수 없다(자사 간 발행이 없는 한 — 드라이런에서 확인).
-- 점검 결과(2026-10-12): 38건 / 31,790,229원, 전부 direction='sales'.
--   이 중 17건(16,702,949원)은 2026-10-12 117_1 파일, 21건은 그 이전 업로드.
-- 조치: 38건 삭제. 테이블에 상대방 한쪽만 저장되므로 SQL로 방향을 바꿔 복구할 수 없다
--   — 삭제 후 홈택스 매입 파일을 다시 올린다(새 코드는 파일에서 방향을 판별한다).
-- 자사 거래처 2건('주식회사 다올커머스' bf1973fe…, '다올커머스' 7c72da2b…)은
--   이 파일에서 지우지 않는다. 드라이런의 참조 건수를 보고 따로 결정한다.
-- =====================================================

-- ── STEP 1. 드라이런 (읽기 전용) ─────────────────────────
-- 1-a. 삭제 대상 전체 — 업로드 묶음(created_at 분)·작성월별로 몇 건인지
--      → 21건 쪽은 어느 달 매입 파일을 다시 받아야 하는지 여기서 안다
SELECT to_char(created_at, 'YYYY-MM-DD HH24:MI')  AS 업로드시각,
       to_char(issue_date, 'YYYY-MM')              AS 작성월,
       tax_type                                    AS 유형,
       direction                                   AS 저장방향,
       COUNT(*)                                    AS 건수,
       SUM(total_amount)                           AS 합계,
       MIN(issue_date) || ' ~ ' || MAX(issue_date) AS 작성일범위
FROM tax_invoices
WHERE counterparty_biz_number = '701-88-00023'
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2;

-- 1-b. 삭제 가드 — 전부 0이어야 한다
--      (수금/지급 확인됨 · 통장 연결 · 분개 · 매칭 메모 있는 행은 사람이 봐야 한다)
SELECT
  (SELECT COUNT(*) FROM tax_invoices WHERE counterparty_biz_number = '701-88-00023')              AS 대상,
  (SELECT COUNT(*) FROM tax_invoices WHERE counterparty_biz_number = '701-88-00023'
     AND payment_status = 'matched')                                                               AS 확인됨,
  (SELECT COUNT(*) FROM tax_invoice_payments p
     JOIN tax_invoices t ON t.id = p.tax_invoice_id
    WHERE t.counterparty_biz_number = '701-88-00023')                                             AS 통장연결,
  (SELECT COUNT(*) FROM journal_entries je
    WHERE je.source_type = 'tax_invoice'
      AND je.source_id IN (SELECT id FROM tax_invoices WHERE counterparty_biz_number = '701-88-00023')) AS 분개,
  (SELECT COUNT(*) FROM tax_invoices WHERE counterparty_biz_number = '701-88-00023'
     AND payment_memo IS NOT NULL AND payment_memo <> '')                                          AS 메모있음;

-- 1-c. 자사 거래처 2건이 다른 곳에서 쓰이는지 (삭제 여부는 별도 결정)
SELECT v.id, v.name, v.biz_number, v.type,
       (SELECT COUNT(*) FROM tax_invoices t WHERE t.vendor_id = v.id
          AND t.counterparty_biz_number IS DISTINCT FROM '701-88-00023')   AS 정상계산서_참조,
       (SELECT COUNT(*) FROM transactions tx WHERE tx.vendor_id = v.id)   AS 통장_참조,
       (SELECT COUNT(*) FROM erp_vendor_aliases a WHERE a.vendor_id = v.id) AS 별칭_참조,
       (SELECT COUNT(*) FROM card_accounts c WHERE c.vendor_id = v.id)    AS 카드사_참조
FROM vendors v
WHERE v.id IN ('bf1973fe-c18b-498e-941b-532abaca3cd7', '7c72da2b-d4a8-4566-ae08-7510ac35ab29');

-- ── STEP 2. 삭제 (1-b가 전부 0일 때만) ──────────────────
DO $$
DECLARE
  v_rows int;
  v_bad  int;
BEGIN
  SELECT COUNT(*) INTO v_rows FROM tax_invoices WHERE counterparty_biz_number = '701-88-00023';
  IF v_rows <> 38 THEN
    RAISE EXCEPTION '대상 건수가 38이 아님: % — 점검 후 다시 실행', v_rows;
  END IF;

  SELECT COUNT(*) INTO v_bad FROM tax_invoices
   WHERE counterparty_biz_number = '701-88-00023'
     AND (payment_status = 'matched' OR (payment_memo IS NOT NULL AND payment_memo <> ''));
  IF v_bad > 0 THEN RAISE EXCEPTION '확인됨·메모 있는 행 % 건 — 중단', v_bad; END IF;

  SELECT COUNT(*) INTO v_bad FROM tax_invoice_payments p
    JOIN tax_invoices t ON t.id = p.tax_invoice_id
   WHERE t.counterparty_biz_number = '701-88-00023';
  IF v_bad > 0 THEN RAISE EXCEPTION '통장 연결 % 건 — 중단', v_bad; END IF;

  SELECT COUNT(*) INTO v_bad FROM journal_entries je
   WHERE je.source_type = 'tax_invoice'
     AND je.source_id IN (SELECT id FROM tax_invoices WHERE counterparty_biz_number = '701-88-00023');
  IF v_bad > 0 THEN RAISE EXCEPTION '분개 참조 % 건 — 중단', v_bad; END IF;

  DELETE FROM tax_invoices WHERE counterparty_biz_number = '701-88-00023';
  RAISE NOTICE '삭제 완료: 뒤집힌 계산서 % 건', v_rows;
END $$;

-- ── STEP 3. 검증 (실행 후) ──────────────────────────────
-- 기대: 남은_뒤집힌행 0
SELECT
  (SELECT COUNT(*) FROM tax_invoices WHERE counterparty_biz_number = '701-88-00023') AS 남은_뒤집힌행,
  (SELECT COUNT(*) FROM tax_invoices WHERE direction = 'purchase' AND tax_type = 'taxable'
     AND issue_date BETWEEN DATE '2026-10-01' AND DATE '2026-10-09')                  AS 매입세금계산서_10월_재업로드전;
