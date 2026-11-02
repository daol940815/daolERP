-- 901: 업무 요청 비공개 플래그 — 업무요청 트랙 2차 (docs/work-request-track.md, 2026-11-02 사용자 결정)
--
-- 목록을 전 직원 공용으로 전환하면서, 인사·급여 등 민감한 요청은 작성 시 '비공개' 체크로
-- 요청자·담당자·승인권자(isManagerLike)만 볼 수 있게 한다. 기본값 공개(false).
-- 코드는 이 열이 없어도 동작한다(공개로 간주) — 실행 전에는 비공개 체크가 저장되지 않는다.

ALTER TABLE work_requests ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN work_requests.is_private IS '비공개 요청: 요청자·담당자·승인권자만 조회 (2026-11-02)';

-- 검증: 열 존재 1 · 비공개 건수(초기 0)
SELECT count(*) AS col_exists FROM information_schema.columns WHERE table_name = 'work_requests' AND column_name = 'is_private';
SELECT count(*) AS private_count FROM work_requests WHERE is_private;
