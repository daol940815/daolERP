-- =====================================================
-- card_duplicate_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 법인카드 사용내역 — 통합양식과 카드사별 파일이 같은 거래를 두 번 올린 범위 (2026-10-28)
--
-- 같은 거래 판정: 카드계좌 · 이용일 · 승인금액 · 취소금액이 같고 source_key가 다른 행.
--   (같은 양식 재업로드는 source_key가 같아 upsert로 합쳐지므로 여기 안 잡힌다.
--    같은 날 같은 금액을 정말 두 번 긁은 정상 거래도 잡힐 수 있어 시각·가맹점명을 같이 보여준다.)
-- 통합양식 행은 source_sheet = 'Sheet 1', 카드사별 파일 행은 시트명이 다르다.
-- =====================================================

WITH g AS (
  SELECT card_account_id, tx_date, approved_amount, cancel_amount,
         COUNT(*) n, COUNT(DISTINCT source_sheet) sheets,
         COUNT(*) FILTER (WHERE source_sheet = 'Sheet 1') integ,
         COUNT(*) FILTER (WHERE source_sheet IS DISTINCT FROM 'Sheet 1') percompany
  FROM card_expenses
  GROUP BY card_account_id, tx_date, approved_amount, cancel_amount
  HAVING COUNT(*) > 1
),
dup AS (   -- 통합 ↔ 카드사별 양쪽에 다 있는 묶음만
  SELECT * FROM g WHERE integ > 0 AND percompany > 0
),
rows_in_dup AS (
  SELECT e.*, ca.card_company,
         (EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'card' AND je.source_id = e.id)) AS has_journal
  FROM card_expenses e JOIN dup d
    ON d.card_account_id = e.card_account_id AND d.tx_date = e.tx_date
   AND d.approved_amount = e.approved_amount AND d.cancel_amount = e.cancel_amount
  JOIN card_accounts ca ON ca.id = e.card_account_id
)
SELECT jsonb_pretty(jsonb_build_object(

  -- [1] 어떤 파일이 언제 올라갔나 (시트명 × 업로드 날짜)
  '업로드_이력', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t->>'업로드일', t->>'시트'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object('업로드일', created_at::date, '시트', source_sheet, '건수', COUNT(*),
                                '이용일범위', MIN(tx_date) || ' ~ ' || MAX(tx_date)) AS t
      FROM card_expenses GROUP BY created_at::date, source_sheet
    ) s
  ),

  -- [2] 중복 규모
  '중복_요약', (
    SELECT jsonb_build_object(
      '묶음수', (SELECT COUNT(*) FROM dup),
      '행수', COUNT(*),
      '통합양식_행', COUNT(*) FILTER (WHERE source_sheet = 'Sheet 1'),
      '카드사별_행', COUNT(*) FILTER (WHERE source_sheet IS DISTINCT FROM 'Sheet 1'),
      '승인합_한쪽', (SELECT COALESCE(SUM(approved_amount), 0) FROM dup),
      '이용일범위', MIN(tx_date) || ' ~ ' || MAX(tx_date),
      '확정된_행', COUNT(*) FILTER (WHERE classify_status = 'confirmed'),
      '분개있는_행', COUNT(*) FILTER (WHERE has_journal),
      '추천만_행', COUNT(*) FILTER (WHERE classify_status <> 'confirmed' AND suggested_account_id IS NOT NULL)
    ) FROM rows_in_dup
  ),
  '중복_카드사별', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('카드사', card_company, '행수', n, '통합', i, '카드사별', p) ORDER BY card_company), '[]'::jsonb)
    FROM (SELECT card_company, COUNT(*) n, COUNT(*) FILTER (WHERE source_sheet = 'Sheet 1') i,
                 COUNT(*) FILTER (WHERE source_sheet IS DISTINCT FROM 'Sheet 1') p
          FROM rows_in_dup GROUP BY card_company) s
  ),

  -- [3] 어느 쪽에 사람 작업(확정·분개)이 있나 — 정리 때 남길 쪽 결정용
  '사람작업_분포', (
    SELECT jsonb_build_object(
      '통합만_확정', (SELECT COUNT(*) FROM dup d WHERE
         EXISTS (SELECT 1 FROM rows_in_dup r WHERE r.card_account_id = d.card_account_id AND r.tx_date = d.tx_date AND r.approved_amount = d.approved_amount AND r.cancel_amount = d.cancel_amount AND r.source_sheet = 'Sheet 1' AND r.classify_status = 'confirmed')
         AND NOT EXISTS (SELECT 1 FROM rows_in_dup r WHERE r.card_account_id = d.card_account_id AND r.tx_date = d.tx_date AND r.approved_amount = d.approved_amount AND r.cancel_amount = d.cancel_amount AND r.source_sheet IS DISTINCT FROM 'Sheet 1' AND r.classify_status = 'confirmed')),
      '카드사별만_확정', (SELECT COUNT(*) FROM dup d WHERE
         NOT EXISTS (SELECT 1 FROM rows_in_dup r WHERE r.card_account_id = d.card_account_id AND r.tx_date = d.tx_date AND r.approved_amount = d.approved_amount AND r.cancel_amount = d.cancel_amount AND r.source_sheet = 'Sheet 1' AND r.classify_status = 'confirmed')
         AND EXISTS (SELECT 1 FROM rows_in_dup r WHERE r.card_account_id = d.card_account_id AND r.tx_date = d.tx_date AND r.approved_amount = d.approved_amount AND r.cancel_amount = d.cancel_amount AND r.source_sheet IS DISTINCT FROM 'Sheet 1' AND r.classify_status = 'confirmed')),
      '양쪽_확정', (SELECT COUNT(*) FROM dup d WHERE
         EXISTS (SELECT 1 FROM rows_in_dup r WHERE r.card_account_id = d.card_account_id AND r.tx_date = d.tx_date AND r.approved_amount = d.approved_amount AND r.cancel_amount = d.cancel_amount AND r.source_sheet = 'Sheet 1' AND r.classify_status = 'confirmed')
         AND EXISTS (SELECT 1 FROM rows_in_dup r WHERE r.card_account_id = d.card_account_id AND r.tx_date = d.tx_date AND r.approved_amount = d.approved_amount AND r.cancel_amount = d.cancel_amount AND r.source_sheet IS DISTINCT FROM 'Sheet 1' AND r.classify_status = 'confirmed'))
    )
  ),

  -- [4] 표본 — 같은 거래의 두 행이 어떻게 다르게 적혀 있는지 (시각·가맹점명·부가세·키)
  '표본', (
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object('카드사', card_company, '이용일', tx_date, '시각', tx_time, '승인', approved_amount, '취소', cancel_amount,
                                '가맹점', merchant_name, '부가세', tax_amount, '시트', source_sheet, '상태', classify_status,
                                '분개', has_journal, '업로드', created_at::date, 'key', source_key) AS t
      FROM rows_in_dup
      ORDER BY card_account_id, tx_date, approved_amount, source_sheet LIMIT 16
    ) s
  ),

  -- [5] 묶음 안에 3행 이상(같은 날 같은 금액이 여러 번) — 정리 때 사람이 볼 것
  '3행이상_묶음', (SELECT COUNT(*) FROM dup WHERE n >= 3)

)) AS check_result;
