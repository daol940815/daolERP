-- =====================================================
-- 202_schedule_rules.sql
-- 인사·총무 트랙 — 스케줄 관리 규칙
--
-- 배경: 스케줄 1단계는 기존 ERP 데이터(휴가·공휴일·아르바이트·대출)만 모아 보여줬다.
--       ERP 어디에도 둘 자리가 없는 일정 — 급여일·법인카드 출금일·세무 마감·회사 행사·
--       외근·회의 — 을 한곳에서 관리한다 (스케줄 화면의 '관리' 탭).
--
-- 원칙:
--  - 반복 일정은 날짜별로 펼쳐 저장하지 않는다. 규칙만 저장하고 조회 시 그 달의 날짜를 계산한다.
--  - **휴일 처리 방향이 항목마다 다르다** (2026-10-14 사용자 확인):
--      세무 신고·납부 기한 → 다음 영업일로 순연(next)
--      급여       → 말일이 휴일이면 직전 영업일로 앞당김(prev)
--      대출 자동이체 → 순연 (loans 테이블에서 별도 처리)
--  - 세무 마감도 이 표로 옮긴다(2026-10-14 결정) — 법인세는 결산월, 부가세는 과세 유형에
--    따라 달라지므로 코드 상수보다 사용자가 끄고 고칠 수 있는 편이 낫다.
-- =====================================================

CREATE TABLE IF NOT EXISTS schedule_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('payroll', 'tax', 'company', 'meeting', 'other')),
    -- payroll: 급여·지급 / tax: 세무 / company: 회사 행사·휴무 / meeting: 외근·회의 / other
  repeat_kind   TEXT NOT NULL DEFAULT 'monthly'
    CHECK (repeat_kind IN ('monthly', 'yearly', 'once')),
  repeat_day    SMALLINT CHECK (repeat_day BETWEEN 1 AND 31),   -- 매월·매년 일자 (31 = 말일)
  repeat_month  SMALLINT CHECK (repeat_month BETWEEN 1 AND 12), -- 매년일 때 월
  on_date       DATE,                                           -- 1회성 시작일
  end_date      DATE,                                           -- 1회성 종료일 (여러 날 외근)
  holiday_shift TEXT NOT NULL DEFAULT 'next'
    CHECK (holiday_shift IN ('prev', 'next', 'none')),           -- 휴일이면 앞당김/순연/그대로
  amount        BIGINT,                                          -- 예상 금액 (선택)
  employee_id   UUID REFERENCES employees(id) ON DELETE SET NULL, -- 외근·회의 대상 직원
  finance_only  BOOLEAN NOT NULL DEFAULT false,                  -- 회계 조회 권한자에게만 노출
  active        BOOLEAN NOT NULL DEFAULT true,
  memo          TEXT,
  created_by    UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 반복 종류에 맞는 값이 들어왔는지 확인
  CHECK (
    (repeat_kind = 'monthly' AND repeat_day IS NOT NULL) OR
    (repeat_kind = 'yearly'  AND repeat_day IS NOT NULL AND repeat_month IS NOT NULL) OR
    (repeat_kind = 'once'    AND on_date IS NOT NULL)
  ),
  CHECK (end_date IS NULL OR on_date IS NULL OR end_date >= on_date)
);

CREATE INDEX IF NOT EXISTS idx_schedule_rules_active ON schedule_rules(active) WHERE active;
CREATE INDEX IF NOT EXISTS idx_schedule_rules_once   ON schedule_rules(on_date)
  WHERE repeat_kind = 'once';

ALTER TABLE schedule_rules ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE schedule_rules IS
  '스케줄 관리 규칙 — ERP 원본에서 끌어올 수 없는 일정(급여일·카드 출금일·세무 마감·회사 행사·외근). 반복은 규칙만 저장하고 날짜는 조회 시 계산.';
COMMENT ON COLUMN schedule_rules.repeat_day IS '매월·매년 일자. 31은 말일로 해석한다(loans.payment_day와 같은 규칙).';
COMMENT ON COLUMN schedule_rules.holiday_shift IS
  'prev: 휴일이면 직전 영업일로 앞당김(급여) / next: 다음 영업일로 순연(세무·자동이체) / none: 그대로';
COMMENT ON COLUMN schedule_rules.finance_only IS
  'true면 회계 조회 권한자에게만 내려보낸다(서버에서 제외). 세무·지급 금액 보호용.';

-- ── 초기 데이터 ────────────────────────────────────────
-- 세무 마감(법정 기한)과 급여일. 회사 사정에 맞게 화면에서 수정·비활성할 수 있다.
INSERT INTO schedule_rules (title, category, repeat_kind, repeat_day, repeat_month, holiday_shift, finance_only)
SELECT * FROM (VALUES
  ('원천세 신고·납부',        'tax',     'monthly', 10, NULL, 'next', true),
  ('4대보험 납부',            'tax',     'monthly', 10, NULL, 'next', true),
  ('부가세 확정신고 (2기)',    'tax',     'yearly',  25, 1,    'next', true),
  ('부가세 예정신고 (1기)',    'tax',     'yearly',  25, 4,    'next', true),
  ('부가세 확정신고 (1기)',    'tax',     'yearly',  25, 7,    'next', true),
  ('부가세 예정신고 (2기)',    'tax',     'yearly',  25, 10,   'next', true),
  ('법인세 신고·납부',        'tax',     'yearly',  31, 3,    'next', true),
  ('법인세 중간예납',          'tax',     'yearly',  31, 8,    'next', true),
  -- 급여일: 매월 말일, 휴일이면 앞당김 (2026-10-14 사용자 확인). 전 직원 공개.
  ('급여일',                  'payroll', 'monthly', 31, NULL, 'prev', false)
) AS v(title, category, repeat_kind, repeat_day, repeat_month, holiday_shift, finance_only)
WHERE NOT EXISTS (SELECT 1 FROM schedule_rules);

-- 법인카드 대금 출금일은 날짜 확인 후 화면에서 등록한다 (카드사별로 다를 수 있음).
