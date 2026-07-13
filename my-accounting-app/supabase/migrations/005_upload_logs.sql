-- =====================================================
-- 005_upload_logs.sql
-- 업로드 이력(Upload Log) 테이블
-- 파일 업로드 이벤트를 추적하고 중복 업로드를 방지
-- =====================================================

CREATE TABLE IF NOT EXISTS upload_logs (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  -- 업로드된 원본 파일명
  file_name       VARCHAR(500) NOT NULL,
  -- 파일 형식: csv, xlsx, xls
  file_type       VARCHAR(20),
  -- 파일 크기 (바이트)
  file_size       BIGINT,
  -- 파일 내용 해시 (MD5 등) - 동일 파일 재업로드 방지용
  file_hash       VARCHAR(64),
  -- 데이터 출처: bank(은행), card(카드), manual(수동)
  source          VARCHAR(20) DEFAULT 'bank' CHECK (source IN ('bank', 'card', 'manual')),
  -- 계좌/카드 별칭 (어느 계좌에서 가져온 파일인지)
  account_alias   VARCHAR(100),
  -- 업로드된 거래 건수 (파일 내 총 행수)
  total_rows      INTEGER     DEFAULT 0,
  -- 실제로 DB에 저장된 건수 (중복 제외 후)
  inserted_rows   INTEGER     DEFAULT 0,
  -- 중복으로 건너뛴 건수
  skipped_rows    INTEGER     DEFAULT 0,
  -- 파싱 오류 건수
  error_rows      INTEGER     DEFAULT 0,
  -- 업로드 처리 상태: pending(처리중), success(성공), failed(실패), partial(부분성공)
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'partial')),
  -- 오류 메시지 (실패 시 상세 내용)
  error_message   TEXT,
  -- 업로드 수행자 (Supabase Auth user id)
  uploaded_by     UUID,
  -- 처리 완료 시각
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 업로드 일시 기준 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_upload_logs_created_at ON upload_logs(created_at DESC);

-- 파일 해시로 중복 체크를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_upload_logs_file_hash ON upload_logs(file_hash);

-- 상태별 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_upload_logs_status ON upload_logs(status);

-- 업로드 후 transactions.upload_log_id FK 추가 (003이 먼저 생성되어야 함)
ALTER TABLE transactions
  ADD CONSTRAINT fk_transactions_upload_log
  FOREIGN KEY (upload_log_id) REFERENCES upload_logs(id) ON DELETE SET NULL;

-- updated_at 자동 갱신 트리거
DROP TRIGGER IF EXISTS trg_upload_logs_updated_at ON upload_logs;
CREATE TRIGGER trg_upload_logs_updated_at
  BEFORE UPDATE ON upload_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
