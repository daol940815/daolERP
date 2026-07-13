-- =====================================================
-- 033_vendor_ledger_entries.sql
-- 매입처 정산 원장 (기초잔액 / 입금 / 조정) — append-only
--
-- 현재잔액(미지급금) = 기초잔액 + 계산서(tax_invoices) - 입금 + 조정
-- 계산서는 tax_invoices를 그대로 사용(중복 저장 안 함), 기초잔액·입금·조정만 이 테이블에 기록한다.
--
-- entry_type:
--   opening    : 기초잔액(시스템 도입 전 미지급금). 거래처당 여러 건 추가 가능 — 가장 최근 건이
--                현재 유효한 기초잔액이며, 이전 건들은 수정 이력(로그)으로 남는다. amount는 항상 양수.
--   payment    : 입금(거래처에 지급한 금액). amount는 항상 양수.
--   adjustment : 수동 조정. amount는 양수(미지급 증가)/음수(감소) 모두 허용.
-- =====================================================

CREATE TABLE IF NOT EXISTS vendor_ledger_entries (
  id             UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id      UUID         NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  entry_type     VARCHAR(10)  NOT NULL CHECK (entry_type IN ('opening', 'payment', 'adjustment')),
  entry_date     DATE         NOT NULL,
  amount         BIGINT       NOT NULL,
  memo           TEXT,
  -- 실제 입출금 거래내역과 연결된 입금 건 (수동 입력 시 NULL)
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  DEFAULT now()
);

-- 같은 거래내역을 두 번 입금으로 등록하는 것을 방지
CREATE UNIQUE INDEX IF NOT EXISTS idx_vle_unique_transaction
  ON vendor_ledger_entries(transaction_id) WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vle_vendor_date ON vendor_ledger_entries(vendor_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_vle_vendor_type ON vendor_ledger_entries(vendor_id, entry_type);
