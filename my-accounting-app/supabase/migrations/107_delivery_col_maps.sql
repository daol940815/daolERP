-- =====================================================
-- 107_delivery_col_maps.sql
-- 배송조회 프로그램 — 변형 접수양식 열 매핑 학습 저장
--  - 사용자가 등록 페이지에서 수정한 열 매핑을 양식(헤더 구성) 단위로 저장
--  - 같은 헤더 구성의 파일은 다음 업로드부터 자동으로 이 매핑이 적용됨
--  - id = 헤더 행 정규화 문자열의 해시 (프로그램의 vendorSig)
-- =====================================================

CREATE TABLE IF NOT EXISTS delivery_col_maps (
  id         TEXT PRIMARY KEY,            -- 헤더 시그니처 (v+해시)
  mapping    JSONB NOT NULL DEFAULT '{}', -- { 프로그램항목: 열번호(0기준) }
  sample     TEXT NOT NULL DEFAULT '',    -- 헤더 미리보기 (관리 참고용)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE delivery_col_maps ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE delivery_col_maps IS
  '변형 접수양식 열 매핑 학습. Cloudflare Workers(/db/colmaps) 경유로만 접근';
