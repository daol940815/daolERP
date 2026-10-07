-- =====================================================
-- tx_kind_coverage_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 은행 구분(tx_kind) → 계정 키워드 매핑 현황 (2026-10-07)
-- 선행: 409 실행 + 통합계좌 파일 업로드
--
-- 분류기(Step 0)는 accounts.keywords 중 tx_kind와 **정확히 같은** 키워드를 가진
-- 계정이 딱 하나일 때만 추천한다. 이 점검은
--   · 어떤 구분 값이 몇 건 있고
--   · 그 값을 키워드로 가진 계정이 0개(미등록)·1개(정상)·2개 이상(모호)인지
-- 보여준다. '미등록' 행의 구분 값을 해당 계정과목의 키워드에 등록하면 다음 분류부터 잡힌다.
-- =====================================================

WITH kinds AS (
  SELECT tx_kind,
         COUNT(*)                                        AS 건수,
         COUNT(*) FILTER (WHERE status = 'pending')      AS 미분류,
         COUNT(*) FILTER (WHERE suggested_account_id IS NOT NULL
                            AND ai_reason LIKE '은행 구분:%') AS 구분추천,
         COALESCE(SUM(amount_in), 0)                     AS 입금,
         COALESCE(SUM(amount_out), 0)                    AS 출금,
         MIN(tx_date) AS 최초, MAX(tx_date) AS 최종
  FROM transactions
  WHERE tx_kind IS NOT NULL
  GROUP BY tx_kind
),
kw AS (
  -- 계정 키워드를 (소문자·trim) 1행 1키워드로 펼친다
  SELECT a.id, a.code, a.name, a.type, lower(btrim(k)) AS kw
  FROM accounts a, unnest(COALESCE(a.keywords, '{}'::text[])) AS k
  WHERE a.is_active
)

SELECT jsonb_pretty(jsonb_build_object(

  '구분별_현황', (
    SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'건수')::int DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '구분', k.tx_kind,
        '건수', k.건수, '미분류', k.미분류, '구분추천됨', k.구분추천,
        '입금', k.입금, '출금', k.출금,
        '기간', k.최초 || ' ~ ' || k.최종,
        '키워드_보유계정', (SELECT COALESCE(jsonb_agg(w.code || ' ' || w.name), '[]'::jsonb)
                           FROM kw w WHERE w.kw = lower(btrim(k.tx_kind))),
        '상태', CASE (SELECT COUNT(*) FROM kw w WHERE w.kw = lower(btrim(k.tx_kind)))
                  WHEN 0 THEN '미등록 — 키워드 등록 필요'
                  WHEN 1 THEN '정상'
                  ELSE '모호 — 계정 2개 이상이 같은 키워드' END
      ) AS t
      FROM kinds k
    ) s
  ),

  -- 대출번호가 적요에 찍힌 거래 — loans.loan_account_no 연결 후보
  '대출번호_적요', (
    SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'건수')::int DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '대출번호', substring(btrim(description) from '^(\d{10,})'),
        '구분들', jsonb_agg(DISTINCT tx_kind),
        '건수', COUNT(*),
        '출금합', COALESCE(SUM(amount_out), 0),
        '은행', (SELECT ba.bank_name FROM bank_accounts ba WHERE ba.id = MIN(t.bank_account_id::text)::uuid),
        '연결된_대출', (SELECT l.title FROM loans l
                        WHERE regexp_replace(COALESCE(l.loan_account_no, ''), '[^0-9]', '', 'g')
                              = substring(btrim(t.description) from '^(\d{10,})')
                        LIMIT 1)
      ) AS t
      FROM transactions t
      WHERE btrim(description) ~ '^\d{10,}(-\d+)?$'
        AND tx_kind IS NOT NULL
      GROUP BY substring(btrim(description) from '^(\d{10,})')
    ) s
  ),

  '요약', jsonb_build_object(
    '구분보유_거래', (SELECT COUNT(*) FROM transactions WHERE tx_kind IS NOT NULL),
    '구분으로_추천된_거래', (SELECT COUNT(*) FROM transactions WHERE ai_reason LIKE '은행 구분:%'),
    '구분값_종류', (SELECT COUNT(*) FROM kinds),
    '미등록_구분값', (SELECT COUNT(*) FROM kinds k
                      WHERE NOT EXISTS (SELECT 1 FROM kw w WHERE w.kw = lower(btrim(k.tx_kind))))
  )

)) AS check_result;
