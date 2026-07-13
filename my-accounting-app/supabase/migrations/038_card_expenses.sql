-- =====================================================
-- 038_card_expenses.sql
-- 법인카드 사용내역 (지출/비용) — 통장내역(transactions)과 동일한 방식으로 관리.
-- 카드사_카드번호 단위로 "카드계좌(card_accounts)"를 두고, 사용내역을 card_expenses에 보관.
-- ※ 기존 card_sales(카드매출=수입)와는 완전히 별개의 도메인.
-- =====================================================

-- ── 카드계좌 (bank_accounts에 대응) ─────────────────
CREATE TABLE IF NOT EXISTS card_accounts (
  id           UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  card_company VARCHAR(50)  NOT NULL,           -- 카드사 (예: 하나카드)
  card_number  VARCHAR(30)  NOT NULL,           -- 마스킹 카드번호 (예: 5531-****-****-3826)
  alias        VARCHAR(100),                    -- 표시 별칭 (선택)
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  DEFAULT now(),
  updated_at   TIMESTAMPTZ  DEFAULT now(),
  UNIQUE (card_company, card_number)
);

-- ── 법인카드 사용내역 (transactions에 대응) ─────────
CREATE TABLE IF NOT EXISTS card_expenses (
  id                  UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  card_account_id     UUID         REFERENCES card_accounts(id) ON DELETE SET NULL,

  -- 원본 정보
  tx_date             DATE         NOT NULL,        -- 이용일
  tx_time             TEXT,                         -- 이용시간 (HH:MM)
  card_type           VARCHAR(40),                  -- 카드구분 (국내 일시불 / 체크계좌승인 …)
  merchant_name       VARCHAR(200),                 -- 가맹점명
  merchant_category   VARCHAR(100),                 -- 업종명
  merchant_biz_number VARCHAR(30),                  -- 가맹점 사업자번호
  approved_amount     BIGINT       DEFAULT 0,       -- 승인금액 (= 사용액 기준)
  cancel_amount       BIGINT       DEFAULT 0,       -- 승인취소금액
  settled_amount      BIGINT       DEFAULT 0,       -- 매입금액 (참고용)
  statement_status    VARCHAR(20),                  -- 상태 (정상 / 취소 …)
  usage_type          VARCHAR(40),                  -- 이용구분
  submall             TEXT,                         -- 하위몰 정보
  source_sheet        TEXT,                         -- 원본시트
  user_name           VARCHAR(50),                  -- 사용자

  -- 계정과목 분류 (통장내역과 동일한 pending/confirmed 흐름)
  --  - 파일에 '계정과목'이 있으면 즉시 confirmed
  --  - 없으면 키워드 분류기가 suggested 로 제안 → 화면에서 승인 시 confirmed
  suggested_account_id  UUID       REFERENCES accounts(id) ON DELETE SET NULL,
  confirmed_account_id  UUID       REFERENCES accounts(id) ON DELETE SET NULL,
  classify_status       VARCHAR(12) NOT NULL DEFAULT 'pending'
                          CHECK (classify_status IN ('pending', 'confirmed')),
  ai_confidence         NUMERIC,
  ai_reason             TEXT,
  classification        VARCHAR(100),               -- '분류' (자유 텍스트 하위분류)
  memo                  TEXT,

  upload_log_id       UUID,
  -- 중복키: 카드번호|이용일|이용시간|승인금액|가맹점명 (+ 동일키 내 순번)
  source_key          TEXT         NOT NULL UNIQUE,

  created_at          TIMESTAMPTZ  DEFAULT now(),
  updated_at          TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_card_expenses_account ON card_expenses(card_account_id);
CREATE INDEX IF NOT EXISTS idx_card_expenses_date    ON card_expenses(tx_date);
CREATE INDEX IF NOT EXISTS idx_card_expenses_status  ON card_expenses(classify_status);
CREATE INDEX IF NOT EXISTS idx_card_expenses_account_code ON card_expenses(confirmed_account_id);
