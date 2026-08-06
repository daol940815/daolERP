-- =====================================================
-- 400_accounting_pending_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 회계 트랙 미결 항목 현황 점검 (docs/accounting-track.md 미결 1·4·5·6번)
-- 전체를 한 번에 실행하면 JSON 하나로 모든 점검 결과가 나온다.
-- 결과(JSON)를 복사해 회계 세션에 전달할 것.
-- 전제: 마이그레이션 106(vat_manual_entries) 실행 완료 (2026-08-06 확인).
-- =====================================================

SELECT jsonb_pretty(jsonb_build_object(

  -- [A] 부가세 수동 입력 현황 (신고기간별)
  'A_vat_manual_entries', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'period', period_key, 'item', item_key,
      'supply', supply_amount, 'tax', tax_amount, 'memo', memo
    ) ORDER BY period_key, item_key), '[]'::jsonb)
    FROM vat_manual_entries
  ),

  -- [B] 미결 1번: 계좌별 분류 진행 현황 (하나 …1704·우리 …3634 pending 확인)
  'B_account_status', (
    SELECT jsonb_agg(t ORDER BY (t->>'pending')::int DESC)
    FROM (
      SELECT jsonb_build_object(
        'account', account_alias, 'total', count(*),
        'pending',   count(*) FILTER (WHERE status = 'pending'),
        'reviewed',  count(*) FILTER (WHERE status = 'reviewed'),
        'confirmed', count(*) FILTER (WHERE status = 'confirmed')
      ) AS t
      FROM transactions GROUP BY account_alias
    ) s
  ),

  -- [C] 미결 4번: '검토됨(reviewed)' 잔여 건 연도별 분포 (2025년분 포함 여부 확인)
  'C_reviewed_by_year', (
    SELECT coalesce(jsonb_agg(t ORDER BY (t->>'year')::int), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'year', date_part('year', tx_date)::int, 'count', count(*),
        'sum_in', sum(amount_in), 'sum_out', sum(amount_out)
      ) AS t
      FROM transactions WHERE status = 'reviewed'
      GROUP BY date_part('year', tx_date)
    ) s
  ),

  -- [C2] reviewed 잔여 건 계좌x연도 분포 (확정 범위 판단용)
  'C2_reviewed_by_account', (
    SELECT coalesce(jsonb_agg(t ORDER BY (t->>'count')::int DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'account', account_alias, 'year', date_part('year', tx_date)::int,
        'count', count(*)
      ) AS t
      FROM transactions WHERE status = 'reviewed'
      GROUP BY account_alias, date_part('year', tx_date)
    ) s
  ),

  -- [D] 미결 5번: 카드매출 2026-05 공급가·세액 미기재 요약 (기대: 32건, 약 2,462만)
  'D_card_sales_zero_vat', (
    SELECT jsonb_build_object(
      'count', count(*), 'sum_amount', sum(amount),
      'first_date', min(tx_date), 'last_date', max(tx_date)
    )
    FROM card_sales
    WHERE tx_date >= '2026-05-01' AND tx_date < '2026-06-01'
      AND transaction_type = 'approval'
      AND supply_amount = 0 AND tax_amount = 0 AND amount <> 0
  ),

  -- [D2] 해당 건 상세 (원자료 대조용 — 승인번호·매입사 기준)
  'D2_card_sales_zero_vat_rows', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'date', tx_date, 'approval', approval_number, 'acquirer', acquirer,
      'card', card_number, 'amount', amount
    ) ORDER BY tx_date, approval_number), '[]'::jsonb)
    FROM card_sales
    WHERE tx_date >= '2026-05-01' AND tx_date < '2026-06-01'
      AND transaction_type = 'approval'
      AND supply_amount = 0 AND tax_amount = 0 AND amount <> 0
  ),

  -- [E] 미결 3번 기준선: 이체쌍 연결 현황 (2026-08-06 확인: 2010행/1005쌍)
  'E_transfer_pairs', (
    SELECT jsonb_build_object(
      'linked_rows', count(*),
      'pairs', count(DISTINCT transfer_pair_id)
    )
    FROM transactions WHERE transfer_pair_id IS NOT NULL
  )

)) AS check_result;
