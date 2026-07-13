-- =====================================================
-- 061_purchase_cycle_reviews.sql
-- 매입 사이클 "확인" 이력 (설계: docs/purchase-cycle-design.md §5)
--
-- 원칙: 잠금이 아니다. 상태 자체는 저장하지 않고(§2-1), 사용자가
-- "확인함"을 누른 사실 + 그 시점의 세 축 금액 스냅샷만 남긴다.
-- 이후 데이터가 바뀌어 현재 금액이 스냅샷과 달라지면 조회 측이
-- 자동으로 "재검토 필요"를 표시한다. 행은 지우지 않고 쌓는다(이력).
-- =====================================================

CREATE TABLE IF NOT EXISTS purchase_cycle_reviews (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id        UUID        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  -- 'YYYY-MM' 또는 거래처 단위 행(지급 대기·과다 지급)의 '누계'
  month            VARCHAR(10) NOT NULL,
  -- 확인 당시의 상태 (같은 거래처×월이라도 월별 상태와 거래처 롤업 행이 공존하므로 키에 포함)
  status           VARCHAR(20) NOT NULL,
  reviewed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by      TEXT,
  note             TEXT,
  -- 확인 시점에 화면에서 본 세 축 금액 (재검토 판정 기준)
  snapshot_erp     BIGINT      NOT NULL DEFAULT 0,
  snapshot_invoice BIGINT      NOT NULL DEFAULT 0,
  snapshot_paid    BIGINT      NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pcr_vendor_month
  ON purchase_cycle_reviews (vendor_id, month, status, reviewed_at DESC);
