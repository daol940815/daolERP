-- =====================================================
-- 409_tx_kind_and_loan_account_no.sql  (회계 트랙)
-- 은행 통합계좌 파일의 '구분' 컬럼 보관 + 대출 계좌번호 (2026-10-07 사용자 승인)
--
-- 배경: 통합계좌 거래내역의 '구분'은 은행 시스템이 거래 종류에 붙인 코드다
-- (대출이자·대출상환·원리금상환·예금이자·건강·전기·수도·통신·한도수수 …).
-- 적요에 키워드가 없는 거래(대출번호만 적힌 이자·원금, 빈 적요의 예금이자)를
-- 가를 유일한 단서인데 지금은 버리고 있었다. 원본 보존 원칙대로 값만 저장하고
-- 해석(계정 추천)은 분류기에서 한다.
--
-- 영향: 컬럼 추가뿐. 기존 행은 NULL. 중복 키(dedup_key)에는 넣지 않는다.
-- =====================================================

-- 1) 통장 거래의 은행 구분 코드
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tx_kind TEXT;
COMMENT ON COLUMN transactions.tx_kind IS
  '은행 파일의 거래 구분(통합계좌 파일의 구분 컬럼). 원본 그대로 저장, 자동분류 1차 단서. 개별 명세서에는 없을 수 있음(NULL).';

-- 분류기가 "구분 있는 미분류 건"을 빠르게 집는 용도
CREATE INDEX IF NOT EXISTS idx_transactions_tx_kind
  ON transactions(tx_kind) WHERE tx_kind IS NOT NULL;

-- 2) 대출 마스터의 대출(계좌)번호 — 통장 적요의 "47598009367842-00001" 같은 값을
--    이 대출로 연결하기 위한 키. 하이픈 뒤 일련번호는 떼고 숫자만 비교한다.
ALTER TABLE loans ADD COLUMN IF NOT EXISTS loan_account_no TEXT;
COMMENT ON COLUMN loans.loan_account_no IS
  '은행 대출번호(통장 적요에 찍히는 번호). 대출이자·대출상환 거래를 이 대출로 자동 연결하는 키.';

-- ── 검증 (실행 후) ───────────────────────────────────────
-- 기대: 두 컬럼 모두 존재, tx_kind 보유 건수 0 (아직 업로드 전)
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'tx_kind')        AS has_tx_kind,
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'loans' AND column_name = 'loan_account_no')       AS has_loan_account_no,
  (SELECT COUNT(*) FROM transactions WHERE tx_kind IS NOT NULL)           AS tx_with_kind;
