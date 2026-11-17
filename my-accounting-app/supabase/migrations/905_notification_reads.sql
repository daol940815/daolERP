-- 905: 알림 확인 기록 — 업무요청 트랙 알림 센터 (docs/work-request-track.md "확인한 알림 숨기기")
--
-- 사용자 요청(2026-11-17): "알림 목록이 너무 길어. 확인한 알람은 다시 나오지 않도록."
-- 알림 자체는 여전히 저장하지 않는다(/api/notifications 가 원본 상태에서 계산). 여기에는 직원이 "확인"한 결과 통지(info)의 key만 남긴다.
--  · item_key = 알림 항목 key (예: wr:ev:<이벤트 id>, leave:decided:<휴가 id>, orep:in:<주문 id>:<시각>)
--  · item_key = '*' 한 행 = "모두 확인" 시각 — 그 시각 이전에 생긴 결과 통지는 전부 숨김
-- 해야 할 것 · 기다리는 것(마감 지남 · 미확인 · 완료 확정 대기 등)은 일이 끝나야 사라지므로 여기 대상이 아니다.
-- 결과 통지는 최근 7일만 계산되므로 30일 지난 행은 API가 저장할 때 지운다('*' 행 제외).

CREATE TABLE IF NOT EXISTS notification_reads (
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  item_key     TEXT NOT NULL,
  read_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, item_key)
);
ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;   -- 서비스 키 경유 API만
COMMENT ON TABLE notification_reads IS '알림 센터 결과 통지 확인 기록(직원별). item_key=''*'' 는 모두 확인 시각. 30일 지난 행은 API가 정리.';

-- 검증 (실행 후 결과 확인)
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'notification_reads')   AS 테이블_기대1,
  (SELECT count(*) FROM pg_indexes WHERE tablename = 'notification_reads')                  AS 인덱스_기대1,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'notification_reads')                AS RLS_기대true;
