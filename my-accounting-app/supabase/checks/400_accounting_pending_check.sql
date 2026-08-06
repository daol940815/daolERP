-- =====================================================
-- 400_accounting_pending_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 회계 트랙 미결 항목 현황 점검 (docs/accounting-track.md 미결 1·4·5·6번)
-- Supabase SQL 편집기에서 블록별로 실행하고 결과를 회계 세션에 전달.
-- =====================================================

-- [점검 A] 미결 6번: 마이그레이션 106(vat_manual_entries) 실행 여부
-- 결과가 NULL이면 미실행 → 106_vat_manual_entries.sql 실행 필요.
SELECT to_regclass('public.vat_manual_entries') AS vat_manual_entries_table;

-- (106 실행된 경우) 신고기간별 수동 입력 현황
-- SELECT period_key, item_key, supply_amount, tax_amount, memo, updated_at
-- FROM vat_manual_entries ORDER BY period_key, item_key;

-- [점검 B] 미결 1번: 계좌별 분류 진행 현황
-- 하나 …1704(618건)·우리 …3634(378건)가 pending으로 남아 있는지 확인.
SELECT account_alias,
       count(*)                                  AS total,
       count(*) FILTER (WHERE status = 'pending')   AS pending,
       count(*) FILTER (WHERE status = 'reviewed')  AS reviewed,
       count(*) FILTER (WHERE status = 'confirmed') AS confirmed
FROM transactions
GROUP BY account_alias
ORDER BY pending DESC, account_alias;

-- [점검 C] 미결 4번: '검토됨(reviewed)' 잔여 건 — 연도별 분포
-- 2025년분 포함 여부 재확인용.
SELECT date_part('year', tx_date)::int AS year,
       count(*)                        AS reviewed_count,
       sum(amount_in)                  AS sum_in,
       sum(amount_out)                 AS sum_out
FROM transactions
WHERE status = 'reviewed'
GROUP BY 1
ORDER BY 1;

-- [점검 C-2] reviewed 잔여 건 계좌별 분포 (확정 범위 판단용)
SELECT account_alias, date_part('year', tx_date)::int AS year, count(*) AS reviewed_count
FROM transactions
WHERE status = 'reviewed'
GROUP BY 1, 2
ORDER BY 3 DESC;

-- [점검 D] 미결 5번: 카드매출 2026년 5월 공급가·세액 미기재 건
-- 기대값: 32건, 결제금액 합계 약 2,462만 원. 원자료 보정 전 현황 확인.
SELECT count(*)                AS zero_vat_count,
       sum(amount)             AS sum_amount,
       min(tx_date)            AS first_date,
       max(tx_date)            AS last_date
FROM card_sales
WHERE tx_date >= '2026-05-01' AND tx_date < '2026-06-01'
  AND transaction_type = 'approval'
  AND supply_amount = 0 AND tax_amount = 0
  AND amount <> 0;

-- [점검 D-2] 해당 건 상세 (원자료 대조용 — 승인번호·매입사 기준으로 재확인)
SELECT tx_date, approval_number, acquirer, card_number, amount
FROM card_sales
WHERE tx_date >= '2026-05-01' AND tx_date < '2026-06-01'
  AND transaction_type = 'approval'
  AND supply_amount = 0 AND tax_amount = 0
  AND amount <> 0
ORDER BY tx_date, approval_number;

-- [점검 E] 미결 3번 참고: 이체쌍 미연결 현황 (미등록 계좌 업로드 전 기준선)
-- 잔여 67건이 유지되는지 확인 — 급여통장 내역 업로드 후 재실행하여 해소 검증.
SELECT count(*) AS transfer_linked_rows,
       count(DISTINCT transfer_pair_id) AS transfer_pairs
FROM transactions
WHERE transfer_pair_id IS NOT NULL;
