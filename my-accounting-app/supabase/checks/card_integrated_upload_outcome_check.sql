-- =====================================================
-- card_integrated_upload_outcome_check.sql
-- (2026-10-23 수정: 시트명 조건 제거 — 기존 내역이 06-29까지라 기간만으로 통합양식 행을 가른다.
--  첫 실행(업로드 전)은 전부 0이 정상.)  (읽기 전용 — 데이터 변경 없음)
-- 법인카드 통합양식 업로드 후 검증 (2026-10-23)
--
-- 파일 기대값(드라이런): 387행 전부 신규(컷오프 0) — 정상 343 · 가승인 취소 16(금액 0) · 환불 취소 28
--   승인합 39,369,520 / 취소합 5,785,160 / 순액 33,584,360 / 부가세 3,008,451
--   카드사별 롯데 194 · 하나 175 · 우리 18, 카드 11장 전부 기존 카드계좌에 붙음(새 카드 0)
-- 확인할 것
--  [1] 2026-06-30 이후 카드사별 건수·금액이 기대값과 같은가
--  [2] 새로 생긴 카드계좌가 없는가 (있으면 번호 치환 실패 — 카드가 갈라진 것)
--  [3] 취소 행 중 "이미 원거래 행에 취소가 반영된" 중복 환불 후보 — 역분개가 두 번 잡힐 위험
--      (하나·우리 카드사별 파일은 승인취소를 원거래 행의 cancel_amount로 기록한다)
--  [4] 분개: 확정 건만 전기됐는가 (업로드 직후엔 0이 정상 — 분류·확정 후 생성)
-- =====================================================

SELECT jsonb_pretty(jsonb_build_object(

  -- [1] 카드사별 집계 (통합양식 기간)
  '카드사별', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t->>'카드사'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '카드사', ca.card_company,
        '건수', COUNT(*),
        '정상', COUNT(*) FILTER (WHERE e.statement_status IS NULL),
        '가승인취소', COUNT(*) FILTER (WHERE e.statement_status = '가승인 취소'),
        '환불취소', COUNT(*) FILTER (WHERE e.statement_status = '취소'),
        '승인합', COALESCE(SUM(e.approved_amount), 0),
        '취소합', COALESCE(SUM(e.cancel_amount), 0),
        '부가세합', COALESCE(SUM(e.tax_amount), 0),
        '카드수', COUNT(DISTINCT e.card_account_id),
        '추천있음', COUNT(*) FILTER (WHERE e.suggested_account_id IS NOT NULL),
        '확정', COUNT(*) FILTER (WHERE e.classify_status = 'confirmed')
      ) AS t
      FROM card_expenses e JOIN card_accounts ca ON ca.id = e.card_account_id
      WHERE e.tx_date BETWEEN DATE '2026-06-30' AND DATE '2026-09-30'
      GROUP BY ca.card_company
    ) s
  ),
  '전체', (
    SELECT jsonb_build_object('건수', COUNT(*), '승인합', COALESCE(SUM(approved_amount), 0),
                              '취소합', COALESCE(SUM(cancel_amount), 0),
                              '순액', COALESCE(SUM(approved_amount - cancel_amount), 0))
    FROM card_expenses
    WHERE tx_date BETWEEN DATE '2026-06-30' AND DATE '2026-09-30'
  ),

  -- [2] 카드계좌 — 기대 11장 그대로, 새 행 0
  '카드계좌_전체', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('카드사', card_company, '카드번호', card_number,
                                                 '생성', to_char(created_at, 'YYYY-MM-DD'),
                                                 '내역수', (SELECT COUNT(*) FROM card_expenses e WHERE e.card_account_id = ca.id))
                              ORDER BY card_company, card_number), '[]'::jsonb)
    FROM card_accounts ca
  ),
  '오늘_생긴_카드계좌', (SELECT COUNT(*) FROM card_accounts WHERE created_at::date = CURRENT_DATE),

  -- [3] 중복 환불 후보: 통합양식 취소 행과 같은 카드·가맹점·금액의 원거래 행에 이미 cancel_amount가 있는 경우
  '중복환불_후보', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t->>'취소일'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object('취소일', c.tx_date, '가맹점', c.merchant_name, '취소금액', c.cancel_amount,
                                '원거래일', o.tx_date, '원거래_취소반영', o.cancel_amount) AS t
      FROM card_expenses c
      JOIN card_expenses o ON o.card_account_id = c.card_account_id
                          AND o.merchant_name = c.merchant_name
                          AND o.approved_amount = c.cancel_amount
                          AND o.cancel_amount > 0
                          AND o.tx_date <= c.tx_date AND o.id <> c.id
      WHERE c.statement_status = '취소'
        AND c.tx_date BETWEEN DATE '2026-06-30' AND DATE '2026-09-30'
    ) s
  ),
  -- 짝 없는 환불(원거래가 6/30 이전 또는 다른 금액) — 참고용 건수
  '짝없는_환불', (
    SELECT COUNT(*) FROM card_expenses c
    WHERE c.statement_status = '취소'
      AND c.tx_date BETWEEN DATE '2026-06-30' AND DATE '2026-09-30'
      AND NOT EXISTS (
        SELECT 1 FROM card_expenses o
        WHERE o.card_account_id = c.card_account_id AND o.merchant_name = c.merchant_name
          AND o.approved_amount = c.cancel_amount AND o.id <> c.id
          AND o.tx_date BETWEEN DATE '2026-06-30' AND DATE '2026-09-30')
  ),

  -- [4] 분개 — 확정 건만
  '분개', (
    SELECT jsonb_build_object(
      '전기건수', COUNT(*),
      '확정건수', (SELECT COUNT(*) FROM card_expenses WHERE classify_status = 'confirmed'
                    AND tx_date BETWEEN DATE '2026-06-30' AND DATE '2026-09-30'))
    FROM journal_entries je
    WHERE je.source_type = 'card'
      AND je.source_id IN (SELECT id FROM card_expenses
                           WHERE tx_date BETWEEN DATE '2026-06-30' AND DATE '2026-09-30')
  )

)) AS check_result;
