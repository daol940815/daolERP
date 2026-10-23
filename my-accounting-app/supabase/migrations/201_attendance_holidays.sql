-- =====================================================
-- 201_attendance_holidays.sql
-- 인사·근태 트랙 — 공휴일 테이블
--
-- 배경: 200에서는 주말만 근무일에서 제외해, 공휴일에 출퇴근 기록이 없으면
--       '미기록(결근)'으로 판정됐다. 공휴일을 근무일에서 제외한다.
--
-- 원칙:
--  - 근무일 여부는 저장하지 않는다. 날짜가 이 표에 있으면 근무일이 아니다.
--  - 법정공휴일(public)과 회사 자체 휴무(company)를 구분한다. public 행은
--    "공휴일 불러오기"(공공데이터포털 특일정보)로 연도 단위 교체 대상이고,
--    company 행(임시공휴일·창립기념일 등)은 교체 시 보존된다.
--  - 근태 현황 화면의 '공휴일 관리'에서 추가·삭제·불러오기 한다.
--
-- 실행 이력: 2026-09-29 사용자 실행 완료. 재실행해도 안전하다
--            (IF NOT EXISTS + ON CONFLICT DO NOTHING).
-- =====================================================

CREATE TABLE IF NOT EXISTS attendance_holidays (
  holiday_date DATE PRIMARY KEY,
  name         TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'public'
    CHECK (source IN ('public', 'company')),   -- public: 법정공휴일 / company: 회사 지정 휴무
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE attendance_holidays ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE attendance_holidays IS
  '공휴일·휴무일. 이 표에 있는 날짜는 근무일에서 제외되어 결근·지각 판정 대상이 아니다.';
COMMENT ON COLUMN attendance_holidays.source IS
  'public: 법정공휴일(연도 단위 불러오기로 교체) / company: 회사 자체 휴무(교체 시 보존)';

-- 2026년 법정공휴일 초기값 (대체공휴일 포함)
-- 음력 기반(설날·부처님오신날·추석)과 대체공휴일은 화면의 "공휴일 불러오기"로
-- 공공데이터포털 공식 데이터로 교체하는 것을 권장한다.
INSERT INTO attendance_holidays (holiday_date, name, source) VALUES
  ('2026-01-01', '신정',                  'public'),
  ('2026-02-16', '설날 연휴',              'public'),
  ('2026-02-17', '설날',                  'public'),
  ('2026-02-18', '설날 연휴',              'public'),
  ('2026-03-01', '삼일절',                'public'),
  ('2026-03-02', '삼일절 대체공휴일',        'public'),
  ('2026-05-05', '어린이날',               'public'),
  ('2026-05-24', '부처님오신날',            'public'),
  ('2026-05-25', '부처님오신날 대체공휴일',   'public'),
  ('2026-06-03', '지방선거일',             'public'),
  ('2026-06-06', '현충일',                'public'),
  ('2026-08-15', '광복절',                'public'),
  ('2026-08-17', '광복절 대체공휴일',        'public'),
  ('2026-09-24', '추석 연휴',              'public'),
  ('2026-09-25', '추석',                  'public'),
  ('2026-09-26', '추석 연휴',              'public'),
  ('2026-09-28', '추석 대체공휴일',          'public'),
  ('2026-10-03', '개천절',                'public'),
  ('2026-10-05', '개천절 대체공휴일',        'public'),
  ('2026-10-09', '한글날',                'public'),
  ('2026-12-25', '성탄절',                'public')
ON CONFLICT (holiday_date) DO NOTHING;
