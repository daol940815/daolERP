-- =====================================================
-- 106_delivery_mail.sql
-- 배송조회 프로그램 — 매입처 메일 발송 기능
--  - delivery_suppliers    : 매입처 주소록 (이메일·참조·담당자)
--  - delivery_mail_presets : 메일 제목/본문 프리셋
--  - delivery_mail_log     : 발송 이력 (중복 발송 확인용)
--  - 접근 경로: 프로그램 → Cloudflare Workers → 이 테이블 (105와 동일)
-- =====================================================

CREATE TABLE IF NOT EXISTS delivery_suppliers (
  name       TEXT PRIMARY KEY,           -- 매입처명 (배송 데이터의 매입처 항목과 동일 표기)
  email      TEXT NOT NULL DEFAULT '',   -- 받는 사람 (쉼표로 여러 명 가능)
  cc         TEXT NOT NULL DEFAULT '',   -- 참조
  manager    TEXT NOT NULL DEFAULT '',   -- 매입처 담당자명 (표시용)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_mail_presets (
  id         TEXT PRIMARY KEY,           -- 프로그램이 부여 (p+타임스탬프)
  name       TEXT NOT NULL DEFAULT '',   -- 프리셋 이름
  subject    TEXT NOT NULL DEFAULT '',   -- 제목 ({매입처}·{건수}·{날짜} 자리표시자 지원)
  body       TEXT NOT NULL DEFAULT '',   -- 본문
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_mail_log (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier   TEXT NOT NULL DEFAULT '',
  to_email   TEXT NOT NULL DEFAULT '',
  subject    TEXT NOT NULL DEFAULT '',
  item_count INT  NOT NULL DEFAULT 0,    -- 첨부된 미회신 건수
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delivery_mail_log_supplier ON delivery_mail_log (supplier, sent_at DESC);

-- RLS: 활성화만 (정책 없음) — Workers의 secret key로만 접근
ALTER TABLE delivery_suppliers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_mail_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_mail_log     ENABLE ROW LEVEL SECURITY;
