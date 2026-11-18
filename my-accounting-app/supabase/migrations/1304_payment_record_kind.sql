-- =====================================================
-- 1304_payment_record_kind.sql  (결제처리 트랙 — docs/payment-track.md)
-- 결제 기록에 카드 결제 방식(단말기 · 수기) · 과세 구분(과세 · 면세) 칸 추가  (2026-11-18 사용자 확정)
--
-- 이전 ERP의 여섯 구분(카드단말기 과세 · 면세, 수기 과세 · 면세, 계산서 과세 · 면세)과 같은 정보.
--   카드결제     = card_entry + vat_kind
--   계산서 발행  = vat_kind 만
--   계좌이체     = 둘 다 NULL (받지 않는다)
-- 이전에 남긴 기록은 NULL 그대로 둔다 = 화면에 '미기재'. 추정해 채우지 않는다.
-- 원본(card_sales · tax_invoices)은 건드리지 않는다. 재실행 안전.
-- =====================================================

ALTER TABLE order_payment_records ADD COLUMN IF NOT EXISTS card_entry TEXT
  CHECK (card_entry IS NULL OR card_entry IN ('terminal', 'manual'));
ALTER TABLE order_payment_records ADD COLUMN IF NOT EXISTS vat_kind TEXT
  CHECK (vat_kind IS NULL OR vat_kind IN ('taxable', 'exempt'));

COMMENT ON COLUMN order_payment_records.card_entry IS '카드 결제 방식: terminal = 단말기 · manual = 수기(PG). 카드결제 기록만. NULL = 미기재(1304 이전 기록) 또는 해당 없음';
COMMENT ON COLUMN order_payment_records.vat_kind   IS '과세 구분: taxable = 과세 · exempt = 면세. 카드결제 · 계산서 발행 기록만. NULL = 미기재 또는 해당 없음(계좌이체)';

-- ── 검증 (실행 뒤 결과를 알려 주세요) ─────────────────────
-- ① 칸 두 개가 생겼는지 — 기대 2
SELECT count(*) AS new_columns FROM information_schema.columns
WHERE table_name = 'order_payment_records' AND column_name IN ('card_entry', 'vat_kind');
-- ② 이전 기록 현황 — 수단별 건수 · 그중 매칭 완료 (전부 미기재로 남는다)
SELECT method, count(*) AS records, count(*) FILTER (WHERE confirmed_at IS NOT NULL) AS matched,
       count(*) FILTER (WHERE card_entry IS NOT NULL OR vat_kind IS NOT NULL) AS with_kind
FROM order_payment_records GROUP BY method ORDER BY method;
