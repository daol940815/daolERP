-- 903: PC 알림(Web Push) 구독 — 업무요청 트랙 ⑦ (docs/work-request-track.md)
--
-- 사용자 결정(2026-11-02): 웹페이지가 닫혀 있어도 PC(브라우저)에 알림. 직원이 PC·브라우저마다 한 번 "허용"하면
-- 그 구독(endpoint·키)을 여기에 저장하고, 서버가 업무 요청·휴가 승인 사건 때 VAPID 서명으로 푸시를 보낸다.
-- 알림 내용은 제목·요청자·마감만(비공개 요청은 "비공개 업무 요청 1건"). 비용 0(브라우저 표준 기능).
-- 받을 알림 종류(prefs)는 구독(기기)마다: wr_new(새 요청) · wr_result(내 요청 반려·처리 보고) · wr_due_today(오늘 마감 아침 09:00) ·
-- leave_approve(휴가 승인 요청, 승인권자). 비어 있으면 전부 켬. 주문 수정 승인은 수정요청 제도 폐지(2026-08-25)로 제외.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL UNIQUE,                 -- 브라우저가 발급한 푸시 주소 (기기·브라우저·프로필마다 다름)
  p256dh        TEXT NOT NULL,                        -- 구독 공개키 (암호화용)
  auth          TEXT NOT NULL,                        -- 구독 인증 비밀 (암호화용)
  device_label  TEXT,                                 -- "Chrome · Windows" 등 (직원이 이름 수정 가능)
  user_agent    TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT true,        -- 기기별 끄기
  prefs         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {wr_new, wr_result, wr_due_today, leave_approve}: false 인 것만 끔
  last_used_at  TIMESTAMPTZ,                          -- 마지막 발송 성공
  last_error    TEXT,                                 -- 마지막 발송 실패 사유 (404·410 은 행 삭제)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_sub_employee ON push_subscriptions(employee_id) WHERE enabled;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;   -- 서비스 키 경유 API만
COMMENT ON TABLE push_subscriptions IS 'Web Push 구독(기기·브라우저별). 업무 요청·휴가 승인 알림을 웹이 닫혀 있어도 PC로. VAPID 키는 Vercel 환경변수.';

-- 검증 (실행 후 결과 확인)
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'push_subscriptions') AS 테이블_기대1,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_push_sub_employee')             AS 인덱스_기대1,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'push_subscriptions')              AS RLS_기대true;
