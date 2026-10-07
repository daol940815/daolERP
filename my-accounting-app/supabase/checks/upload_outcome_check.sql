-- =====================================================
-- upload_outcome_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 방금 올린 통장 파일이 어디로 들어갔는지 확인 (2026-10-07)
--
-- 상황: 통합계좌 업로드 코드가 아직 main에 배포되지 않은 상태에서 업로드가 이루어졌다.
-- 구버전 업로더는 파일 1개 = 계좌 1개라서, 화면에 입력한 은행명으로
--   · 계좌번호 없는 같은 은행명 계좌가 있으면 거기로, 없으면 **새 계좌를 만들어** 전부 넣는다.
-- 이 점검은 (1) 최근 업로드 이력, (2) 그 행들이 어느 계좌에 들어갔는지,
-- (3) 최근 생성된 계좌(가짜 계좌 후보), (4) 기존 정상 계좌 행과의 중복 여부를 보여준다.
-- 결과를 보고 정리(삭제) SQL을 따로 만든다 — 이 파일은 아무것도 바꾸지 않는다.
-- =====================================================

WITH recent_logs AS (
  SELECT id, file_name, created_at, account_alias, total_rows, inserted_rows, status
  FROM upload_logs
  WHERE source = 'bank' AND created_at >= now() - INTERVAL '3 days'
)

SELECT jsonb_pretty(jsonb_build_object(

  -- [1] 최근 3일 통장 업로드 이력
  '최근_업로드', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t->>'일시' DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '로그id', l.id, '일시', l.created_at, '파일', l.file_name,
        '입력은행명', l.account_alias, '총행', l.total_rows, '삽입', l.inserted_rows, '상태', l.status,
        -- 그 로그의 행들이 실제로 들어간 계좌 분포
        '들어간_계좌', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   '계좌id', x.bank_account_id, '은행', ba.bank_name, '계좌번호', ba.account_number,
                   '건수', x.n, '기간', x.d1 || ' ~ ' || x.d2,
                   '구분보유', x.k)), '[]'::jsonb)
          FROM (
            SELECT bank_account_id, COUNT(*) n, MIN(tx_date) d1, MAX(tx_date) d2,
                   COUNT(*) FILTER (WHERE tx_kind IS NOT NULL) k
            FROM transactions WHERE upload_log_id = l.id GROUP BY bank_account_id
          ) x LEFT JOIN bank_accounts ba ON ba.id = x.bank_account_id
        ),
        '행상태', (
          SELECT jsonb_build_object(
            '대기', COUNT(*) FILTER (WHERE status = 'pending'),
            '검토', COUNT(*) FILTER (WHERE status = 'reviewed'),
            '확정', COUNT(*) FILTER (WHERE status = 'confirmed'),
            '추천있음', COUNT(*) FILTER (WHERE suggested_account_id IS NOT NULL))
          FROM transactions WHERE upload_log_id = l.id
        )
      ) AS t
      FROM recent_logs l
    ) s
  ),

  -- [2] 최근 3일 안에 새로 생긴 계좌 — 구버전 업로더가 만든 가짜 계좌 후보
  '최근_생성계좌', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t->>'생성' DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '계좌id', ba.id, '은행', ba.bank_name, '계좌번호', ba.account_number,
        '유형', ba.account_type, '생성', ba.created_at,
        '거래수', (SELECT COUNT(*) FROM transactions t WHERE t.bank_account_id = ba.id),
        '대출연결', (SELECT COUNT(*) FROM loans l WHERE l.bank_account_id = ba.id)
      ) AS t
      FROM bank_accounts ba
      WHERE ba.created_at >= now() - INTERVAL '3 days'
    ) s
  ),

  -- [3] 최근 업로드 행 중, 정상 계좌에 이미 있던 행과 내용이 같은 것 (계좌만 다른 중복)
  --     일자·시각·입금·출금·잔액·적요가 같으면 같은 거래로 본다
  '다른계좌_중복', (
    SELECT jsonb_build_object(
      '건수', COUNT(*),
      '금액', COALESCE(SUM(n.amount_in + n.amount_out), 0)
    )
    FROM transactions n
    JOIN recent_logs l ON l.id = n.upload_log_id
    WHERE EXISTS (
      SELECT 1 FROM transactions o
      WHERE o.upload_log_id <> n.upload_log_id
        AND o.bank_account_id IS DISTINCT FROM n.bank_account_id
        AND o.tx_date = n.tx_date
        AND o.tx_time IS NOT DISTINCT FROM n.tx_time
        AND o.amount_in = n.amount_in AND o.amount_out = n.amount_out
        AND o.balance IS NOT DISTINCT FROM n.balance
        AND o.description = n.description
    )
  ),

  -- [4] 최근 업로드 행 중 이미 손댄 것 (확정·검토·추천 수락) — 있으면 단순 삭제가 아니라 확인 필요
  '손댄_행', (
    SELECT jsonb_build_object(
      '건수', COUNT(*),
      '분개있음', COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM journal_entries je WHERE je.source_type = 'bank' AND je.source_id = n.id))
    )
    FROM transactions n
    JOIN recent_logs l ON l.id = n.upload_log_id
    WHERE n.status <> 'pending' OR n.confirmed_account_id IS NOT NULL
  )

)) AS check_result;
