-- =====================================================
-- 427_card_sales_cpid_vat_kind.sql  (회계 트랙, 2026-11-17 사용자 승인)
-- 카드매출(수기결제 PG 파일)의 CPID 보존 + 과세 · 면세 해석 열
--
-- 배경: 수기결제 파일에는 공급가액 · 세금 열이 없어 0으로 저장되고, 2026-11-12 결정대로 "미기재 = 과세 1.1 분할"로 처리돼 왔다.
--       사용자 확인(2026-11-17): CPID CDA23815 = 면세 CP(다올커머스(비과세)), CDA23814 = 과세 CP. 지금까지 CPID를 읽지 않아
--       CDA23815 매출도 과세로 분개(부가세예수금 과대 · 상품매출 과소)돼 있다.
-- 원칙: 원본 공급가 · 세금 0은 그대로 둔다. 면세 여부는 해석 열(vat_kind)에 두고, 판정 함수(lib/card-sale-vat.ts)가 이 열을 먼저 본다.
-- 단말기결제 파일(공급가액 · 세금 열 있음)은 CPID가 없어 세 열 모두 NULL — 기존 판정 그대로.
-- 기존 행 채우기: PG 파일을 다시 업로드하면 같은 승인번호를 덮어쓰며 CPID · vat_kind가 채워지고 분개가 자동으로 다시 전기된다.
-- =====================================================

ALTER TABLE card_sales ADD COLUMN IF NOT EXISTS cpid     VARCHAR(30);
ALTER TABLE card_sales ADD COLUMN IF NOT EXISTS cp_name  TEXT;
ALTER TABLE card_sales ADD COLUMN IF NOT EXISTS vat_kind VARCHAR(10)
  CHECK (vat_kind IS NULL OR vat_kind IN ('taxable', 'exempt'));

COMMENT ON COLUMN card_sales.cpid     IS '수기결제(PG) 파일의 CPID — 단말기결제 파일에는 없음(NULL)';
COMMENT ON COLUMN card_sales.cp_name  IS '수기결제(PG) 파일의 CP명(서비스명)';
COMMENT ON COLUMN card_sales.vat_kind IS '해석 열: CPID 규칙으로 판정한 과세(taxable) · 면세(exempt). NULL = 판정 없음 → 공급가 · 세액 열로 기존 판정 (lib/card-sale-vat.ts)';

CREATE INDEX IF NOT EXISTS idx_card_sales_cpid ON card_sales (cpid) WHERE cpid IS NOT NULL;

-- ── 검증 (재업로드 뒤 실행) ────────────────────────────
-- ① CPID별 건수 · 금액 · 판정 — CDA23815 행이 전부 exempt 인지
-- SELECT cpid, vat_kind, transaction_type, count(*) AS cnt, sum(amount) AS amount
-- FROM card_sales GROUP BY cpid, vat_kind, transaction_type ORDER BY cpid NULLS LAST, transaction_type;
-- ② 면세 건의 분개에 부가세예수금(2003)이 남아 있으면 안 된다 — 기대 0건
-- SELECT count(*) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
-- JOIN accounts a ON a.id = jl.account_id JOIN card_sales c ON c.id = je.source_id
-- WHERE je.source_type = 'card_sale' AND c.vat_kind = 'exempt' AND a.code = '2003';
