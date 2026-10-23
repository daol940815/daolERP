-- =====================================================
-- card_expense_overlap_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 법인카드 통합양식 업로드 전 점검 (2026-10-23)
--
-- 파일: 승인기간 2026-06-30 ~ 2026-09-30, 387건(정상 343·취소 44), 롯데 194·하나 175·우리 18,
--       카드 11장. 카드번호 마스킹이 카드사별 개별 파일과 다를 수 있다
--       (롯데: 5105-****-****-*373 — 뒤 3자리만 / 하나: 9440-****-****-2078).
-- 확인할 것
--  [1] 같은 기간에 이미 들어온 법인카드 내역 — 카드사별 건수·마지막 이용일 (중복 위험 범위)
--  [2] 등록된 카드계좌의 번호 표기 — 파일의 번호(숫자만)와 맞는지, 안 맞으면 카드가 새로 생긴다
--  [3] 기존 source_key 표본 — 통합양식에서 만든 키와 같은 모양인지 (시각·가맹점명 표기)
-- =====================================================

SELECT jsonb_pretty(jsonb_build_object(

  -- [1] 기간 내 기존 내역 (카드사별)
  '기간내_기존', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t->>'카드사'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '카드사', ca.card_company,
        '건수', COUNT(*),
        '승인합', COALESCE(SUM(e.approved_amount), 0),
        '취소합', COALESCE(SUM(e.cancel_amount), 0),
        '첫이용일', MIN(e.tx_date), '마지막이용일', MAX(e.tx_date),
        '확정', COUNT(*) FILTER (WHERE e.classify_status = 'confirmed'),
        '분개있음', COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM journal_entries je WHERE je.source_type = 'card' AND je.source_id = e.id))
      ) AS t
      FROM card_expenses e JOIN card_accounts ca ON ca.id = e.card_account_id
      WHERE e.tx_date BETWEEN DATE '2026-06-30' AND DATE '2026-09-30'
      GROUP BY ca.card_company
    ) s
  ),

  -- [1b] 카드사별 전체 마지막 이용일 — "이 날짜 이후만 올리기" 기준
  '카드사별_마지막이용일', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('카드사', card_company, '마지막이용일', last_date, '전체건수', n)
                               ORDER BY card_company), '[]'::jsonb)
    FROM (
      SELECT ca.card_company, MAX(e.tx_date) last_date, COUNT(*) n
      FROM card_expenses e JOIN card_accounts ca ON ca.id = e.card_account_id
      GROUP BY ca.card_company
    ) s
  ),

  -- [2] 등록된 카드계좌 — 번호 표기 (숫자만 비교용 digits 포함)
  '카드계좌', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             '카드사', card_company, '카드번호', card_number,
             'digits', regexp_replace(card_number, '[^0-9]', '', 'g'),
             '거래처연결', vendor_id IS NOT NULL,
             '내역수', (SELECT COUNT(*) FROM card_expenses e WHERE e.card_account_id = ca.id))
             ORDER BY card_company, card_number), '[]'::jsonb)
    FROM card_accounts ca
  ),

  -- 파일의 카드 11장 (숫자만) — 위 digits와 대조
  '파일_카드번호_digits', jsonb_build_array(
    jsonb_build_object('카드사','롯데카드','원문','5105-****-****-*373','digits','5105373'),
    jsonb_build_object('카드사','롯데카드','원문','5105-****-****-*473','digits','5105473'),
    jsonb_build_object('카드사','롯데카드','원문','9409-****-****-*573','digits','9409573'),
    jsonb_build_object('카드사','하나카드','원문','5531-****-****-3826','digits','55313826'),
    jsonb_build_object('카드사','하나카드','원문','9440-****-****-2078','digits','94402078'),
    jsonb_build_object('카드사','하나카드','원문','5376-****-****-2242','digits','53762242'),
    jsonb_build_object('카드사','하나카드','원문','5376-****-****-2841','digits','53762841'),
    jsonb_build_object('카드사','하나카드','원문','5376-****-****-1535','digits','53761535'),
    jsonb_build_object('카드사','하나카드','원문','9440-****-****-8781','digits','94408781'),
    jsonb_build_object('카드사','우리카드','원문','9500-****-****-0566','digits','95000566'),
    jsonb_build_object('카드사','우리카드','원문','5532-****-****-7219','digits','55327219')
  ),

  -- [3] 기존 source_key 표본 (카드사별 3건) — 키 모양 확인
  'source_key_표본', (
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object('카드사', ca.card_company, '이용일', e.tx_date, '시각', e.tx_time,
                                '가맹점', e.merchant_name, 'source_key', e.source_key) AS t
      FROM card_expenses e JOIN card_accounts ca ON ca.id = e.card_account_id
      WHERE e.tx_date >= DATE '2026-06-30'
        AND e.id IN (
          SELECT id FROM (
            SELECT e2.id, ROW_NUMBER() OVER (PARTITION BY ca2.card_company ORDER BY e2.tx_date DESC) rn
            FROM card_expenses e2 JOIN card_accounts ca2 ON ca2.id = e2.card_account_id
            WHERE e2.tx_date >= DATE '2026-06-30'
          ) r WHERE rn <= 3
        )
    ) s
  )

)) AS check_result;
