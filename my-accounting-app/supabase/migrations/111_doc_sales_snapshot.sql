-- =====================================================
-- 111_doc_sales_snapshot.sql
-- 고객관리문서 매출이력 스냅샷 (사용자 승인 2026-11-02 "포함해서 진행")
--
-- 배경: ERP 주문 전량 삭제(2026-10-30)로 과거 매출의 주문 원본이 사라짐.
-- 고객관리문서(2026-11-02판)의 지점·담당자별 월별/명절 매출이 유일한 집계
-- 잔존본이라 참고 스냅샷으로 보존한다.
--
-- 성격: **참고 지표** — 주문 원본이 없어 드릴다운 불가("모든 집계는 원본
-- 드릴다운" 원칙의 문서화된 예외, 명절 근사 지표와 동일 취급). 문서 발행
-- 시점(2026-11-02)에 고정되며 수정·갱신하지 않는다. 기준일 이후 실적은
-- erp_orders에서 나오므로 화면에서 출처를 구분해 표시한다.
-- =====================================================

CREATE TABLE IF NOT EXISTS doc_sales_snapshot (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 연결 (마스터 정비 후 매칭 — 미매칭이면 NULL, 원문 표기로 식별)
  vendor_id      UUID REFERENCES vendors(id)  ON DELETE SET NULL,
  contact_id     UUID REFERENCES contacts(id) ON DELETE SET NULL,
  -- 문서 원문 표기 (보존)
  bank_name      TEXT,
  branch_name    TEXT,
  manager_name   TEXT,          -- 담당자 표기 원문 (직함·존칭 포함)
  daol_staff     TEXT,          -- 다올 담당 (문서 기준)
  first_order_date DATE,
  last_order_date  DATE,
  move_history   TEXT,          -- 부서 이동 이력 원문
  memo           TEXT,
  order_type     TEXT,          -- 주문유형 (명절+상시 등 문서 판정)
  total_sales    BIGINT NOT NULL DEFAULT 0,       -- 2025~2026 매출 합계
  season         JSONB  NOT NULL DEFAULT '{}'::jsonb,  -- {"25설":..,"25추석":..,"26설":..,"26추석":..}
  monthly        JSONB  NOT NULL DEFAULT '{}'::jsonb,  -- {"2025-01":..,...} 0원 생략
  source         TEXT   NOT NULL DEFAULT '고객관리문서 2026-11-02',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doc_sales_vendor  ON doc_sales_snapshot(vendor_id)  WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_sales_contact ON doc_sales_snapshot(contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE doc_sales_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "doc_sales_snapshot_all" ON doc_sales_snapshot;
CREATE POLICY "doc_sales_snapshot_all" ON doc_sales_snapshot FOR ALL USING (true);

COMMENT ON TABLE doc_sales_snapshot IS
  '고객관리문서 매출이력 스냅샷(참고 지표, 드릴다운 불가 예외) — ERP 주문 전량 삭제 후 과거 매출의 유일한 집계 잔존본. 수정하지 않는다.';
