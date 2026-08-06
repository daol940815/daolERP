-- =====================================================
-- accounting_pending_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 회계 트랙 미결 항목 현황 점검 (docs/accounting-track.md 미결 1·4·5·6번)
-- 전체를 한 번에 실행하면 JSON 하나로 모든 점검 결과가 나온다.
-- 결과(JSON)를 복사해 회계 세션에 전달할 것.
-- v2 (2026-08-06): 계좌 구분을 은행명이 아닌 bank_account_id 기준으로 수정.
-- v3 (2026-08-06): B2 추가 — pending을 이체쌍 연결 여부로 분리
--   (이체쌍 행은 전기 대상이 아니어서 pending으로 남는 구조 확인용).
-- =====================================================

SELECT jsonb_pretty(jsonb_build_object(

  -- [A] 부가세 수동 입력 현황 (신고기간별) — 2026-08-06 점검: 아직 0건
  'A_vat_manual_entries', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'period', period_key, 'item', item_key,
      'supply', supply_amount, 'tax', tax_amount, 'memo', memo
    ) ORDER BY period_key, item_key), '[]'::jsonb)
    FROM vat_manual_entries
  ),

  -- [B] 미결 1번: 계좌별(계좌번호 단위) 분류 진행 현황
  -- 하나 …1704(618건)·우리 …3634(378건) 및 그 외 pending 분포 확인
  'B_account_status', (
    SELECT jsonb_agg(t ORDER BY (t->>'pending')::int DESC)
    FROM (
      SELECT jsonb_build_object(
        'account', coalesce(b.bank_name, '(미지정)')
                   || coalesce(' …' || right(b.account_number, 4), ''),
        'total', count(*),
        'pending',   count(*) FILTER (WHERE tx.status = 'pending'),
        'reviewed',  count(*) FILTER (WHERE tx.status = 'reviewed'),
        'confirmed', count(*) FILTER (WHERE tx.status = 'confirmed')
      ) AS t
      FROM transactions tx
      LEFT JOIN bank_accounts b ON b.id = tx.bank_account_id
      GROUP BY b.bank_name, b.account_number
    ) s
  ),

  -- [B2] 상태 x 이체쌍 연결 여부 분포
  -- 가설(2026-08-06): 이체쌍 2,010행이 전부 pending → 실제 분류 대기는 약 1,115건
  'B2_status_by_transfer', (
    SELECT jsonb_agg(t ORDER BY t->>'is_transfer', t->>'status')
    FROM (
      SELECT jsonb_build_object(
        'is_transfer', transfer_pair_id IS NOT NULL,
        'status', status, 'count', count(*)
      ) AS t
      FROM transactions
      GROUP BY transfer_pair_id IS NOT NULL, status
    ) s
  ),

  -- [C] 미결 4번: '검토됨(reviewed)' 잔여 건 연도별 분포
  -- 2026-08-06 점검: 2025년 3,109건 / 2026년 1,521건
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
        'account', coalesce(b.bank_name, '(미지정)')
                   || coalesce(' …' || right(b.account_number, 4), ''),
        'year', date_part('year', tx.tx_date)::int,
        'count', count(*)
      ) AS t
      FROM transactions tx
      LEFT JOIN bank_accounts b ON b.id = tx.bank_account_id
      WHERE tx.status = 'reviewed'
      GROUP BY b.bank_name, b.account_number, date_part('year', tx.tx_date)
    ) s
  ),

  -- [D] 미결 5번: 카드매출 2026-05 공급가·세액 미기재 요약
  -- 2026-08-06 점검: 승인 31건 / 24,923,040원 (5/4~5/14). 보정은 마이그레이션 400.
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

  -- [E] 미결 3번 기준선: 이체쌍 연결 현황 (2026-08-06 확인: 2,010행/1,005쌍)
  'E_transfer_pairs', (
    SELECT jsonb_build_object(
      'linked_rows', count(*),
      'pairs', count(DISTINCT transfer_pair_id)
    )
    FROM transactions WHERE transfer_pair_id IS NOT NULL
  )

)) AS check_result;
