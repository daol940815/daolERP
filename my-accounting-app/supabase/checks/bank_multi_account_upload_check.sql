-- =====================================================
-- bank_multi_account_upload_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 은행 통합계좌 거래내역 파일 업로드 사전 점검 (2026-10-07)
--
-- 대상 파일: 통합계좌 거래내역 (（주）다올커머스), 1,356건, 2026-07-14 ~ 2026-10-03
--   한 파일에 계좌 11개가 섞여 있다. 현재 업로더는 파일 1개 = 계좌 1개 전제이므로
--   그대로 올리면 11개 계좌 거래가 한 계좌로 들어간다.
--
-- 이 점검으로 확인할 것
--  [1] 파일의 11개 계좌가 bank_accounts에 등록돼 있는가 (은행명 표기까지 일치하는가)
--      — 표기가 다르면 업로드 시 계좌가 중복 생성된다.
--  [2] 같은 기간에 이미 들어온 거래가 있는가 (있으면 중복 업로드 위험)
--      — dedup_key는 계좌·일시·금액·잔액·적요가 모두 같아야 중복으로 걸러진다.
--        적요 표기가 다른 원본(은행별 개별 명세서)으로 이미 올렸다면 중복이 쌓인다.
--  [3] 미등록 계좌가 있으면 어떤 이름으로 만들지 사용자가 정한다.
-- =====================================================

WITH file_acct(bank_name, account_number, file_rows, file_in, file_out, file_last_balance) AS (
  VALUES
    ('하나은행',   '475-910013-76204',  382,  522055072, 520926772,    1144900),
    ('하나은행',   '369-890010-57804',  321,  724437226, 675324507,    3747965),
    ('우리은행',   '1005-203-358607',   172,  786983275, 417979179,  169592312),
    ('하나은행',   '369-890010-61704',  168,   10536009,  10290480,     380643),
    ('SC제일은행', '690-20-110895',     159,   92873108,  88514615,    4725890),
    ('우리은행',   '1006-301-423634',    55,   31822292,  31606632,     243088),
    ('우리은행',   '1006-001-423633',    39,   54922175,  44922175,   10000000),
    ('농협',       '301-0239-8647-51',   20,   30507000,  29177000,    4900000),
    ('기업은행',   '521-045875-04-010',  20,   10532573,   8028516,    2504057),
    ('국민은행',   '546501-04-104861',   14,    5917200,   5767400,     149800),
    ('신한은행',   '140-012-318640',      6,    1264005,   1264093,          0)
),
-- 계좌번호에서 숫자만 남겨 비교 (하이픈 표기 차이 흡수)
norm_file AS (
  SELECT *, regexp_replace(account_number, '[^0-9]', '', 'g') AS digits FROM file_acct
),
norm_db AS (
  SELECT ba.id, ba.bank_name, ba.account_number, ba.account_type,
         regexp_replace(COALESCE(ba.account_number, ''), '[^0-9]', '', 'g') AS digits
  FROM bank_accounts ba
)

SELECT jsonb_pretty(jsonb_build_object(

  -- [1] 파일의 계좌 × DB 등록 여부
  '파일계좌_매칭', (
    SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'파일건수')::int DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '은행_파일',   f.bank_name,
        '계좌번호',    f.account_number,
        '파일건수',    f.file_rows,
        '파일최종잔액', f.file_last_balance,
        'DB등록',      (db.id IS NOT NULL),
        'DB_은행명',   db.bank_name,
        'DB_계좌번호', db.account_number,
        'DB_계좌유형', db.account_type,
        '은행명_일치', (db.id IS NOT NULL AND db.bank_name = f.bank_name),
        'DB_기존거래수', COALESCE((SELECT COUNT(*) FROM transactions tx WHERE tx.bank_account_id = db.id), 0),
        '기간내_기존거래', COALESCE((SELECT COUNT(*) FROM transactions tx
                                     WHERE tx.bank_account_id = db.id
                                       AND tx.tx_date BETWEEN DATE '2026-07-14' AND DATE '2026-10-03'), 0),
        '기간내_기존입금', COALESCE((SELECT SUM(tx.amount_in) FROM transactions tx
                                     WHERE tx.bank_account_id = db.id
                                       AND tx.tx_date BETWEEN DATE '2026-07-14' AND DATE '2026-10-03'), 0),
        '기간내_기존출금', COALESCE((SELECT SUM(tx.amount_out) FROM transactions tx
                                     WHERE tx.bank_account_id = db.id
                                       AND tx.tx_date BETWEEN DATE '2026-07-14' AND DATE '2026-10-03'), 0),
        '기존_최종거래일', (SELECT MAX(tx.tx_date) FROM transactions tx WHERE tx.bank_account_id = db.id)
      ) AS t
      FROM norm_file f
      LEFT JOIN norm_db db ON db.digits = f.digits
    ) s
  ),

  -- [2] DB에 등록돼 있으나 파일에 없는 계좌 (통합계좌에 빠진 계좌 확인)
  'DB에만_있는계좌', (
    SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'거래수')::int DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '은행', db.bank_name, '계좌번호', db.account_number, '유형', db.account_type,
        '거래수', (SELECT COUNT(*) FROM transactions tx WHERE tx.bank_account_id = db.id),
        '최종거래일', (SELECT MAX(tx.tx_date) FROM transactions tx WHERE tx.bank_account_id = db.id)
      ) AS t
      FROM norm_db db
      WHERE NOT EXISTS (SELECT 1 FROM norm_file f WHERE f.digits = db.digits)
    ) s
  ),

  -- [3] 계좌 미지정 거래 (bank_account_id NULL) — 과거 업로드에서 계좌가 안 붙은 건
  '계좌미지정_거래', (
    SELECT jsonb_build_object(
      '건수', COUNT(*),
      '최소일', MIN(tx_date), '최대일', MAX(tx_date),
      '별칭목록', COALESCE(jsonb_agg(DISTINCT account_alias) FILTER (WHERE account_alias IS NOT NULL), '[]'::jsonb)
    )
    FROM transactions WHERE bank_account_id IS NULL
  ),

  -- [4] 업로드 이력 — 같은 기간 통장 파일을 이미 올렸는지
  '최근_업로드이력', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t->>'일시' DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '일시', created_at, '파일', file_name, '구분', source, '계좌별칭', account_alias,
        '총행', total_rows, '삽입', inserted_rows, '상태', status
      ) AS t
      FROM upload_logs
      WHERE source = 'bank' AND created_at >= now() - INTERVAL '120 days'
      ORDER BY created_at DESC LIMIT 20
    ) s
  ),

  -- [5] 기간 내 기존 통장 거래 전체 요약 (중복 위험 규모)
  '기간내_전체기존', (
    SELECT jsonb_build_object(
      '건수', COUNT(*), '입금', COALESCE(SUM(amount_in), 0), '출금', COALESCE(SUM(amount_out), 0),
      '확정', COUNT(*) FILTER (WHERE status = 'confirmed'),
      '검토', COUNT(*) FILTER (WHERE status = 'reviewed'),
      '대기', COUNT(*) FILTER (WHERE status = 'pending')
    )
    FROM transactions
    WHERE source = 'bank' AND tx_date BETWEEN DATE '2026-07-14' AND DATE '2026-10-03'
  )

)) AS check_result;
