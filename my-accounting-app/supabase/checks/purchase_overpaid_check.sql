-- =====================================================
-- purchase_overpaid_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 매입처 허브의 과다지급 -65,155,980원이 무엇으로 구성되는지 확인 (2026-08-25)
--
-- 왜 과다지급이 되는가 (601 공식):
--   잔액 = GREATEST(0, 기초잔액 - 기준일이후지급)
--        + 기준일이후 계산서 미지급
--        - GREATEST(0, 기준일이후지급 - 기초잔액 - 기준일이후 계산서총액)
--   현재 상태: 기초잔액 = 0 (406곳 전부), 기준일(2026-06-30) 이후 매입 계산서 = 0건
--   → 잔액 = -(기준일 이후 지급액). 즉 **과다지급액 = 7월 이후 지급으로 인식된 금액**이다.
--
-- 지급으로 인식되는 것 두 가지:
--   (1) 매입 계산서에 연결된 지급(tax_invoice_payments)
--       — 단 601 규칙상 연결 계산서 발행일이 기준일 이전이면 제외되므로 현재는 거의 0
--   (2) 미지급금(2001) 계정으로 확정된 통장 출금 중 계산서 미연결분 (카드사 거래처 제외)
--       — 현재 과다지급의 실체는 대부분 여기일 것으로 추정
-- =====================================================

WITH ob AS (
  SELECT vendor_id AS vid, as_of_date, amount FROM purchase_opening_balances
),
pay_invoice AS (   -- (1) 계산서 연결 지급
  SELECT ti.vendor_id AS vid, tx.tx_date, p.amount, ti.issue_date AS linked_issue
  FROM tax_invoice_payments p
  JOIN tax_invoices ti ON ti.id = p.tax_invoice_id AND ti.direction = 'purchase'
  JOIN transactions tx ON tx.id = p.transaction_id
  WHERE ti.vendor_id IS NOT NULL
),
pay_offset AS (    -- (2) 2001 상계 확정 출금 (계산서 미연결·카드사 제외)
  SELECT tx.vendor_id AS vid, tx.tx_date, COALESCE(tx.amount_out, 0) AS amount,
         tx.id AS tx_id, tx.description
  FROM transactions tx
  JOIN accounts ac ON ac.id = tx.confirmed_account_id AND ac.code = '2001'
  WHERE tx.vendor_id IS NOT NULL
    AND tx.status = 'confirmed'
    AND COALESCE(tx.amount_out, 0) > 0
    AND NOT EXISTS (SELECT 1 FROM tax_invoice_payments p2 WHERE p2.transaction_id = tx.id)
    AND NOT EXISTS (SELECT 1 FROM card_accounts ca WHERE ca.vendor_id = tx.vendor_id)
),
-- 컷오프 통과분만 (기준일 이후 지급 + 연결 계산서도 기준일 이후)
cut_invoice AS (
  SELECT p.vid, p.amount FROM pay_invoice p LEFT JOIN ob ON ob.vid = p.vid
  WHERE (ob.as_of_date IS NULL OR p.tx_date > ob.as_of_date)
    AND (ob.as_of_date IS NULL OR p.linked_issue IS NULL OR p.linked_issue > ob.as_of_date)
),
cut_offset AS (
  SELECT p.* FROM pay_offset p LEFT JOIN ob ON ob.vid = p.vid
  WHERE ob.as_of_date IS NULL OR p.tx_date > ob.as_of_date
)

SELECT jsonb_pretty(jsonb_build_object(

  -- [1] 과다지급 총액의 구성 (합이 허브의 음수 잔액과 일치해야 한다)
  '구성', jsonb_build_object(
    '계산서연결_지급', (SELECT jsonb_build_object('건수', COUNT(*), '금액', COALESCE(SUM(amount), 0)) FROM cut_invoice),
    '2001상계_출금',  (SELECT jsonb_build_object('건수', COUNT(*), '금액', COALESCE(SUM(amount), 0)) FROM cut_offset),
    '합계',           (SELECT COALESCE(SUM(amount), 0) FROM cut_invoice)
                      + (SELECT COALESCE(SUM(amount), 0) FROM cut_offset)
  ),

  -- [2] 허브 미결제금 현황 (양수 = 실제 미지급 / 음수 = 과다지급)
  '허브_미결제금', (
    SELECT jsonb_build_object(
      'total',          COALESCE(SUM(outstanding), 0),
      'positive_sum',   COALESCE(SUM(outstanding) FILTER (WHERE outstanding > 0), 0),
      'negative_sum',   COALESCE(SUM(outstanding) FILTER (WHERE outstanding < 0), 0),
      'over90',         COALESCE(SUM(over90), 0),
      'opening_remain', COALESCE(SUM(opening_remain), 0),
      'vendors',        COUNT(*)
    )
    FROM hub_purchase_summary(NULL, NULL)
  ),

  -- [3] 기준일 이후 매입 계산서 (0이면 채무가 없어 지급이 전부 과다지급이 된다)
  '기준일이후_매입계산서', (
    SELECT jsonb_build_object('건수', COUNT(*), '금액', COALESCE(SUM(t.total_amount), 0))
    FROM tax_invoices t
    WHERE t.direction = 'purchase' AND t.vendor_id IS NOT NULL
      AND t.issue_date > DATE '2026-06-30'
  ),

  -- [3b] 계산서 업로드 검증 — 방향·월별 건수/금액 (2026-06 이후)
  '계산서_월별', (
    SELECT coalesce(jsonb_agg(t ORDER BY t->>'월', t->>'구분'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '구분', direction, '월', to_char(issue_date, 'YYYY-MM'),
        '건수', COUNT(*), '금액', COALESCE(SUM(total_amount), 0),
        '거래처미연결', COUNT(*) FILTER (WHERE vendor_id IS NULL)
      ) AS t
      FROM tax_invoices
      WHERE issue_date >= DATE '2026-06-01'
      GROUP BY direction, to_char(issue_date, 'YYYY-MM')
    ) s
  ),

  -- [3c] 거래처(vendor_id) 미연결 매입 계산서 — 미연결이면 허브 집계에 잡히지 않는다
  '매입계산서_거래처미연결', (
    SELECT jsonb_build_object('건수', COUNT(*), '금액', COALESCE(SUM(total_amount), 0))
    FROM tax_invoices
    WHERE direction = 'purchase' AND vendor_id IS NULL
      AND issue_date > DATE '2026-06-30'
  ),

  -- [4] 과다지급 상위 거래처 (금액순 15곳)
  '상위_거래처', (
    SELECT coalesce(jsonb_agg(t ORDER BY (t->>'금액')::bigint DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '거래처', v.name, '건수', COUNT(*), '금액', SUM(c.amount),
        '첫지급', MIN(c.tx_date), '마지막지급', MAX(c.tx_date)
      ) AS t
      FROM cut_offset c JOIN vendors v ON v.id = c.vid
      GROUP BY v.name ORDER BY SUM(c.amount) DESC LIMIT 15
    ) s
  ),

  -- [5] 월별 분포 (7월·8월에 몰려 있는지)
  '월별', (
    SELECT coalesce(jsonb_agg(t ORDER BY t->>'월'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object('월', to_char(tx_date, 'YYYY-MM'),
                                '건수', COUNT(*), '금액', SUM(amount)) AS t
      FROM cut_offset GROUP BY to_char(tx_date, 'YYYY-MM')
    ) s
  )

)) AS check_result;
