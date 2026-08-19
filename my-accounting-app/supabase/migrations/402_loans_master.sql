-- =====================================================
-- 402_loans_master.sql  (회계 트랙)
-- 대출 원리금 별도 관리 (2026-08-11 사용자 결정)
--   1) 장기차입금 계정(2003) 신설
--   2) 대출 마스터 loans 테이블 신설
--   3) 대출현황 엑셀(26.06.24 기준) 9건 적재
-- 주의: 보류 중인 대출 원리금 거래 61건의 분류·분개는 이 마이그레이션에서
--       하지 않는다 (사용자 지시로 대기 — 대출 정보 확인·수정 후 진행).
-- =====================================================

-- ── 1. 장기차입금 계정 (멱등) ────────────────────────────
-- 일반 계좌 거래 관점: 입금 = 차입 실행 → 대변 / 출금 = 원금 상환 → 차변.
-- (2002 단기차입금은 마이너스통장 관점이라 side가 반대 — 042 참조)
-- 주의: 최초 작성 시 코드를 '2003'으로 잘못 지정했다(이미 부가세예수금이 쓰는 코드).
--   2003으로 실행한 DB는 403_fix_long_term_borrowing_code.sql로 원복할 것.
INSERT INTO accounts (code, name, type, side_on_in, side_on_out, is_active)
VALUES ('2004', '장기차입금', 'liability', 'credit', 'debit', true)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      type = EXCLUDED.type,
      side_on_in = EXCLUDED.side_on_in,
      side_on_out = EXCLUDED.side_on_out;

-- ── 2. 대출 마스터 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS loans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq               INT,                    -- 현황표 번호 (①=1 …)
  entity            TEXT DEFAULT '주다올',  -- 구분
  bank_name         TEXT NOT NULL,
  title             TEXT NOT NULL,          -- 내용 (예: 신용보증기금(24년))
  bank_account_id   UUID REFERENCES bank_accounts(id) ON DELETE SET NULL, -- 원리금 출금 계좌
  original_amount   BIGINT NOT NULL DEFAULT 0,   -- 원 대출금액
  current_balance   BIGINT NOT NULL DEFAULT 0,   -- 현 대출잔액 (balance_date 기준)
  balance_date      DATE,                        -- 잔액 기준일
  interest_rate     NUMERIC(7,4),                -- 현재 이율(%)
  rate_note         TEXT,                        -- 금리 산정 내역
  monthly_principal BIGINT NOT NULL DEFAULT 0,   -- 월 원금 상환액(고정, 0=이자만 납부)
  monthly_interest  BIGINT NOT NULL DEFAULT 0,   -- 월 이자(참고용 — 변동금리라 매월 달라짐)
  payment_day       SMALLINT,                    -- 이자/상환일 (말일은 31)
  start_date        DATE,                        -- 신규일
  maturity_date     DATE,                        -- 만기일
  -- 단기/장기 구분: 차입 약정 기간(1년 초과=long) 기준 제안값. 유동성 대체 등
  -- 회계적 재분류는 화면에서 사용자가 편집한다.
  term_type         TEXT NOT NULL DEFAULT 'long' CHECK (term_type IN ('short', 'long')),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unused', 'closed')),
  memo              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE loans ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_loans_updated_at ON loans;
CREATE TRIGGER trg_loans_updated_at
  BEFORE UPDATE ON loans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE loans IS
  '대출 마스터 (대출현황 엑셀 기준). 원리금 거래 분리·분개의 기준 정보. 잔액·금리 등은 화면에서 편집.';

-- ── 3. 대출현황(26.06.24) 9건 적재 (멱등: seq 기준) ─────────
-- 계좌 연결: 은행명 + 계좌번호 끝 4자리로 조회 (하나 …7804 / 우리 …8607 / 우리 …3633)
INSERT INTO loans (seq, bank_name, title, bank_account_id, original_amount, current_balance,
                   balance_date, interest_rate, rate_note, monthly_principal, monthly_interest,
                   payment_day, start_date, maturity_date, term_type, status, memo)
SELECT v.seq, v.bank_name, v.title,
       (SELECT b.id FROM bank_accounts b
         WHERE b.bank_name = v.bank_name AND right(b.account_number, 4) = v.acct4
         LIMIT 1),
       v.original_amount, v.current_balance, DATE '2026-06-24', v.interest_rate, v.rate_note,
       v.monthly_principal, v.monthly_interest, v.payment_day, v.start_date, v.maturity_date,
       v.term_type, v.status, v.memo
FROM (VALUES
  (1, '하나은행', '마이너스(미사용)',      '7804',  150000000::bigint,          0::bigint, 6.4850::numeric, '금융채1년물(3.035(기준)+3.450(가산))',       0::bigint,       0::bigint, 15, DATE '2024-03-22', DATE '2026-03-22', 'short', 'unused',
     '만기(26-03-22) 경과 — 갱신 여부 확인 필요'),
  (2, '하나은행', '신용보증기금(24년)',    '7804',  300000000,          270000000, 3.8560, '금융채6개월물(2.868(기준)+0.988(가산))', 0,  867600, 16, DATE '2024-06-17', DATE '2027-05-14', 'long', 'active',
     '분할상환 3,000만 기실행 — 상환 방식(비정기 여부) 확인 필요'),
  (3, '하나은행', '신용보증기금(24년)',    '7804',  330000000,          330000000, 3.8560, '금융채6개월물(2.868(기준)+0.988(가산))', 0, 1060400, 29, DATE '2024-05-31', DATE '2027-05-14', 'long', 'active', NULL),
  (4, '하나은행', '운전대출',              '7804',  100000000,          100000000, 5.7050, '금융채1년물(3.035(기준)+2.670(가산))',   0,  475417, 21, DATE '2024-03-22', DATE '2027-03-22', 'long', 'active', NULL),
  (5, '하나은행', '시설대출',              '7804', 1929000000,         1929000000, 3.6330, 'FTP고정(3.673(기준)-0.040(가산))',       0, 5840048, 31, DATE '2025-10-31', DATE '2026-02-09', 'long', 'active',
     '신규일>만기일·만기 경과 — 기재 오류 또는 연장 여부 확인 필요'),
  (6, '하나은행', '운전대출',              '7804',  594000000,          580000000, 4.1730, '금융채1년물(2.693(기준)+1.480(가산))', 2000000, 2016950, 31, DATE '2024-02-09', DATE '2026-02-09', 'long', 'active',
     '만기(26-02-09) 경과 — 연장 여부·조건 확인 필요'),
  (7, '우리은행', '마이너스(미사용)',      '8607',  200000000,                  0, 5.3500, 'CD연동금리+2.53',                        0,       0, 10, DATE '2018-05-09', DATE '2025-05-09', 'short', 'unused',
     '만기(25-05-09) 경과 — 갱신 여부 확인 필요'),
  (8, '우리은행', '경기신용보증재단',      '8607',  200000000,          175000000, 3.6500, '6개월변동금리+2.03',                     0,  532292,  5, DATE '2025-02-05', DATE '2028-02-07', 'long', 'active', NULL),
  (9, '우리은행', '중소기업진흥공단(21년)', '3633',  198000000,           33000000, 2.8200, '고정 (2026-11-16 종료)',            5500000,   77550, 14, DATE '2021-11-15', DATE '2026-11-14', 'long', 'active', NULL)
) AS v(seq, bank_name, title, acct4, original_amount, current_balance, interest_rate, rate_note,
       monthly_principal, monthly_interest, payment_day, start_date, maturity_date, term_type, status, memo)
WHERE NOT EXISTS (SELECT 1 FROM loans l WHERE l.seq = v.seq);

-- ── 4. 검증 ────────────────────────────────────────────
-- 기대: 9건 / 잔액 합 3,417,000,000 / 월원금 7,500,000 / 계좌 미연결 0건
SELECT count(*)                                  AS loans,
       sum(current_balance)                      AS balance_total,
       sum(monthly_principal)                    AS monthly_principal_total,
       count(*) FILTER (WHERE bank_account_id IS NULL) AS unlinked_accounts
FROM loans;
