-- =====================================================
-- 710_consultation_sheet_downloads.sql
-- 상담일지 출력 양식 다운로드 기록 — 사용자 승인 2026-11-16 (시안 docs/mockups/상담일지_출력양식_시안.html)
--
-- 상담일지 상세를 실무 양식(엑셀 한 장)으로 내려받아 오프라인 출력물로 전달하는 기능.
-- 결제정보는 ERP 규칙대로 마스킹이 기본이고, 열람 권한자(본인 작성분 · can_view_payment_info)가
-- "결제정보 평문 포함"을 켜서 받으면 누가 언제 받았는지 남긴다(개인정보 · 결제정보 출력물).
-- 마스킹 다운로드도 함께 기록한다(payment_plain = false) — 출력물 전달 이력.
-- 실행 전 데이터 변경 없음 (테이블 생성만). 미적용이면 기록 없이 다운로드는 동작한다.
-- =====================================================

CREATE TABLE IF NOT EXISTS erp_consultation_sheet_downloads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  UUID NOT NULL REFERENCES erp_consultations(id) ON DELETE CASCADE,
  employee_id      UUID REFERENCES employees(id) ON DELETE SET NULL,
  payment_plain    BOOLEAN NOT NULL DEFAULT false,   -- 결제정보 평문 포함 여부
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consult_sheet_downloads ON erp_consultation_sheet_downloads(consultation_id, created_at DESC);
ALTER TABLE erp_consultation_sheet_downloads ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE erp_consultation_sheet_downloads IS '상담일지 출력 양식(엑셀) 다운로드 기록 — 결제정보 평문 포함 여부 (710)';

-- 검증: 테이블_기대1 = 1
SELECT COUNT(*) AS 테이블_기대1
  FROM information_schema.tables
 WHERE table_name = 'erp_consultation_sheet_downloads';
