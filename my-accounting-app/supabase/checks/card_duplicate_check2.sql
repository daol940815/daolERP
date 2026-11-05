-- =====================================================
-- card_duplicate_check2.sql  (읽기 전용 — 데이터 변경 없음)
-- 법인카드 중복 2차 점검 (2026-10-28) — 1차는 "카드계좌·이용일·승인·취소 완전 일치"만 봐서 8묶음.
-- 그런데 업로드 이력상 10-28 'Sheet1' 256행(07-01~09-30)은 통합양식 'Sheet 1'(06-30~10-20)과 기간이 겹치는데
-- 롯데 중복은 2묶음뿐 → 같은 거래가 다른 모양(취소 표기 차이·카드계좌 갈림·시각 없음)으로 들어갔을 수 있다.
-- [1] 카드사 × 월 × 시트 행렬 — 한 달을 두 시트가 같이 덮고 있으면 그 달은 중복 의심
-- [2] 카드계좌별 시트 분포 — 같은 카드가 번호 표기 차이로 두 계좌에 갈렸는지
-- [3] 느슨한 중복 — 카드계좌·이용일·순액(승인−취소)의 절대값이 같고 시트가 다른 묶음 (시각 무시)
-- [4] 통합양식 행 중 같은 날 같은 카드에 카드사별 행이 하나도 없는 달/있는 달 비율
-- =====================================================

SELECT jsonb_pretty(jsonb_build_object(

  '카드사_월_시트', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t->>'카드사', t->>'월', t->>'시트'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object('카드사', ca.card_company, '월', to_char(e.tx_date, 'YYYY-MM'), '시트', e.source_sheet,
                                '행수', COUNT(*), '승인합', SUM(e.approved_amount), '취소합', SUM(e.cancel_amount),
                                '업로드일', string_agg(DISTINCT e.created_at::date::text, ',')) AS t
      FROM card_expenses e JOIN card_accounts ca ON ca.id = e.card_account_id
      WHERE e.tx_date >= DATE '2026-06-01'
      GROUP BY ca.card_company, to_char(e.tx_date, 'YYYY-MM'), e.source_sheet
    ) s
  ),

  '카드계좌별_시트', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t->>'카드사', t->>'카드번호'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object('카드사', ca.card_company, '카드번호', ca.card_number, '생성', ca.created_at::date,
                                '시트별', (SELECT jsonb_object_agg(COALESCE(x.source_sheet, '(없음)'), x.n)
                                           FROM (SELECT source_sheet, COUNT(*) n FROM card_expenses e2
                                                 WHERE e2.card_account_id = ca.id AND e2.tx_date >= DATE '2026-06-30'
                                                 GROUP BY source_sheet) x)) AS t
      FROM card_accounts ca
    ) s
  ),

  '느슨한_중복', (
    WITH g AS (
      SELECT card_account_id, tx_date, abs(approved_amount - cancel_amount) AS net,
             COUNT(*) n, COUNT(DISTINCT source_sheet) sheets,
             SUM(abs(approved_amount - cancel_amount)) amt
      FROM card_expenses
      WHERE tx_date >= DATE '2026-06-30'
      GROUP BY card_account_id, tx_date, abs(approved_amount - cancel_amount)
      HAVING COUNT(*) > 1 AND COUNT(DISTINCT source_sheet) > 1
    )
    SELECT jsonb_build_object(
      '묶음수', COUNT(*), '행수', COALESCE(SUM(n), 0), '한쪽금액합', COALESCE(SUM(net), 0),
      '순액0_묶음', COUNT(*) FILTER (WHERE net = 0),
      '표본', (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('이용일', e.tx_date, '시각', e.tx_time, '승인', e.approved_amount, '취소', e.cancel_amount,
                                  '가맹점', e.merchant_name, '상태표기', e.statement_status, '시트', e.source_sheet,
                                  '분류', e.classify_status, '업로드', e.created_at::date) AS t
        FROM card_expenses e JOIN g ON g.card_account_id = e.card_account_id AND g.tx_date = e.tx_date
                                   AND abs(e.approved_amount - e.cancel_amount) = g.net
        WHERE NOT EXISTS (   -- 1차(엄격) 중복에 이미 잡힌 묶음은 제외
          SELECT 1 FROM card_expenses o WHERE o.id <> e.id AND o.card_account_id = e.card_account_id AND o.tx_date = e.tx_date
            AND o.approved_amount = e.approved_amount AND o.cancel_amount = e.cancel_amount AND o.source_sheet IS DISTINCT FROM e.source_sheet)
        ORDER BY e.card_account_id, e.tx_date, g.net, e.source_sheet LIMIT 20) s)
    ) FROM g
  ),

  '통합양식행_카드사별짝', (
    SELECT jsonb_build_object(
      '통합행', COUNT(*),
      '같은날_같은카드_카드사별행_있음', COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM card_expenses o WHERE o.card_account_id = e.card_account_id AND o.tx_date = e.tx_date
            AND o.source_sheet IS DISTINCT FROM 'Sheet 1')),
      '월별', (SELECT jsonb_object_agg(m, n) FROM (
          SELECT to_char(tx_date, 'YYYY-MM') m, COUNT(*) n FROM card_expenses WHERE source_sheet = 'Sheet 1' GROUP BY 1) x))
    FROM card_expenses e WHERE e.source_sheet = 'Sheet 1'
  )

)) AS check_result;
