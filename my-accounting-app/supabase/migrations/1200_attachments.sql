-- 1200: 공통 첨부 파일 — 2026-11-11 사용자 결정 (docs/attachments-track.md)
--  · 화면마다 따로 만들지 않고 한 벌: 기록 테이블 attachments + 비공개 버킷 'attachments'.
--  · 파일은 브라우저 → Storage 직접 업로드(서명 URL). Vercel 서버를 거치지 않으므로 4.5MB 본문 한도와 무관.
--  · 쓰는 곳은 owner_type 으로 가른다 — 1차 'work_request'(업무 요청). 회의록(1100)은 'meeting' · 'meeting_comment' 예정.
--  · 저장 전(새 요청 작성 중) 올린 파일은 owner_id 없이 draft_key 로 묶어 두었다가, 저장할 때 서버가 owner_id 를 채운다.
--    연결되지 않은 임시 파일은 하루 뒤 아침 크론이 지운다.
--  · 삭제: 파일은 지우고 기록 행은 deleted_at 으로 남긴다(무엇이 있었는지 추적).
--  · 접근은 서비스 키 경유 API(/api/attachments)만 — 테이블 RLS 켜고 정책 없음, 버킷 비공개.
--  실행: Supabase SQL 편집기에서 전체 실행. 여러 번 실행해도 안전하다.

-- 1) 기록 테이블
CREATE TABLE IF NOT EXISTS attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type    TEXT NOT NULL,                       -- 'work_request' | (예정) 'meeting' | 'meeting_comment' ...
  owner_id      UUID,                                -- 저장 전 임시 업로드는 NULL
  draft_key     UUID,                                -- 저장 전 임시 업로드 묶음 키 (화면이 만든 uuid)
  file_name     TEXT NOT NULL,                       -- 원본 파일명 (표시 · 내려받기 이름)
  storage_path  TEXT NOT NULL UNIQUE,                -- 버킷 안 경로 (ASCII 만)
  mime          TEXT,
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  width         INT,                                 -- 사진이면 축소 후 크기
  height        INT,
  uploaded_by   UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,                         -- 삭제 · 정리 시각 (파일은 지우고 행은 남김)
  deleted_by    UUID REFERENCES employees(id) ON DELETE SET NULL,
  CONSTRAINT attachments_owner_or_draft CHECK (owner_id IS NOT NULL OR draft_key IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(owner_type, owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_draft ON attachments(draft_key) WHERE owner_id IS NULL;
COMMENT ON TABLE attachments IS '공통 첨부 파일 기록(1200). 파일 본체는 Storage 버킷 attachments. 삭제 시 행은 남기고 deleted_at 기록.';
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

-- 2) 비공개 버킷 — 파일 1개 10MB 상한을 버킷에서도 강제한다(서명 URL 업로드도 이 한도를 넘지 못한다)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('attachments', 'attachments', false, 10485760)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;

-- 3) 저장 공간 사용량 (마스터 화면 표시용) — Storage 전체 버킷별 파일 수 · 용량
CREATE OR REPLACE FUNCTION storage_usage_by_bucket()
RETURNS TABLE (bucket_id TEXT, files BIGINT, bytes BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = storage, public AS $$
  SELECT o.bucket_id::text, count(*)::bigint, coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  FROM storage.objects o GROUP BY o.bucket_id ORDER BY 3 DESC
$$;
REVOKE ALL ON FUNCTION storage_usage_by_bucket() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION storage_usage_by_bucket() TO service_role;

-- ── 검증 ──────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'attachments') AS 테이블_기대1,
  (SELECT count(*) FROM storage.buckets WHERE id = 'attachments' AND public = false) AS 버킷_기대1,
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'attachments') AS 파일한도_기대10485760,
  (SELECT count(*) FROM storage_usage_by_bucket()) AS 사용량_버킷수;
