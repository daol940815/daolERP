-- =====================================================
-- tx_kind_coverage_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 은행 구분(tx_kind) → 계정 키워드 매핑 현황 (2026-10-07)
-- 선행: 409 실행 + 통합계좌 파일 업로드
--
-- 분류기(Step 0)는 accounts.keywords 중 **'구분:<값>'** 형식(접두 필수, 대소문자 무시)으로
-- 등록된 키워드를 가진 계정이 딱 하나일 때만 추천한다. 적요용 키워드와 이름공간을 분리한
-- 이유는 2026-10-12 사고('인터넷' 채널 구분이 통신비 적요 키워드 '인터넷'에 걸림).
-- 채널·방향 값(인터넷·모바일·타행송금·대체·입금·출금 …)은 등록해도 분류기가 무시한다.
-- 이 점검은 구분 값마다 건수와 '미등록 / 정상 / 모호 / 채널(등록 대상 아님)' 상태를 보여준다.
-- '미등록' 행은 해당 계정과목 키워드에 **'구분:대출이자'** 처럼 등록하면 다음 분류부터 잡힌다.
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
  -- 계정 키워드 중 '구분:' 접두가 붙은 것만, 접두를 떼고 (소문자·trim) 1행 1키워드로 펼친다
  SELECT a.id, a.code, a.name, a.type,
         lower(btrim(substring(k from 4))) AS kw
  FROM accounts a, unnest(COALESCE(a.keywords, '{}'::text[])) AS k
  WHERE a.is_active AND lower(btrim(k)) LIKE '구분:%'
),
channel(v) AS (
  VALUES ('인터넷'),('인터넷당행'),('모바일'),('폰뱅킹'),('텔레뱅킹'),('오픈뱅킹'),('펌뱅킹'),('bz뱅크'),('bz수수'),
         ('대체'),('대체입금'),('대체출금'),('타행'),('타행송금'),('타행이체'),('타행대량'),('당행송금'),('당행이체'),
         ('실시간이체'),('재정이체'),('자동이체'),('cms'),('i/b'),('f/b'),('f/b 출금'),('i-g'),('kft'),('fbc'),('fbs'),('gir'),
         ('atm'),('cd'),('창구'),('무통장'),('입금'),('출금'),('지급')
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
        '상태', CASE
                  WHEN lower(btrim(k.tx_kind)) IN (SELECT v FROM channel) OR lower(btrim(k.tx_kind)) LIKE 'g-%'
                    THEN '채널 — 등록 대상 아님'
                  ELSE CASE (SELECT COUNT(*) FROM kw w WHERE w.kw = lower(btrim(k.tx_kind)))
                    WHEN 0 THEN '미등록 — 키워드 ''구분:' || k.tx_kind || ''' 등록 필요'
                    WHEN 1 THEN '정상'
                    ELSE '모호 — 계정 2개 이상이 같은 키워드' END END
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
                      WHERE NOT EXISTS (SELECT 1 FROM kw w WHERE w.kw = lower(btrim(k.tx_kind)))
                        AND lower(btrim(k.tx_kind)) NOT IN (SELECT v FROM channel)
                        AND lower(btrim(k.tx_kind)) NOT LIKE 'g-%')
  )

)) AS check_result;
