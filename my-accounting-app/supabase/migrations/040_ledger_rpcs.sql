-- =====================================================
-- 040_ledger_rpcs.sql
-- 분개(journal_lines) 기반 원장 RPC
--
-- 분개장(journal_entries + journal_lines)을 원천으로
--   1) 계정별 원장  : account_ledger / accounts_with_journal
--   2) 거래처별 원장: vendor_ledger_balances(잔액 탭) / vendor_ledger_detail(내용 탭)
-- 더존/위하고 거래처원장·계정별원장 표준(일자/적요/상대/차변/대변/잔액누계/전표번호 + 전기이월)
-- 을 참고하여, 잔액 누계는 SQL window function으로 계산한다.
--
-- 잔액 부호 규약
--   계정별: 차변정상 계정(asset/expense)은 (차변-대변), 대변정상 계정(liability/equity/income)은 (대변-차변)
--   거래처별: (차변-대변) 누계 — 양수=채권(미수), 음수=채무(미지급)
-- =====================================================

-- ── 분개에 등장한 계정 목록(계정별 원장 선택용) ──────────────────────
CREATE OR REPLACE FUNCTION accounts_with_journal()
RETURNS TABLE (id uuid, code varchar, name varchar, type varchar, line_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT a.id, a.code, a.name, a.type, count(jl.id) AS line_count
  FROM accounts a
  JOIN journal_lines jl ON jl.account_id = a.id
  GROUP BY a.id, a.code, a.name, a.type
  ORDER BY a.code NULLS LAST, a.name;
$$;

-- ── 계정별 원장 ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION account_ledger(
  p_account_id uuid,
  p_from       date,
  p_to         date
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_type         text;
  v_account      jsonb;
  v_sign         int;       -- 차변정상 +1, 대변정상 -1
  v_opening      numeric;
  v_rows         jsonb;
  v_total_debit  numeric;
  v_total_credit numeric;
BEGIN
  SELECT a.type,
         jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'type', a.type)
    INTO v_type, v_account
  FROM accounts a WHERE a.id = p_account_id;

  IF v_type IS NULL THEN
    RETURN jsonb_build_object('error', '계정을 찾을 수 없습니다.');
  END IF;

  v_sign := CASE WHEN v_type IN ('asset', 'expense') THEN 1 ELSE -1 END;

  -- 전월(전기)이월: p_from 이전 모든 분개의 누적 잔액
  SELECT COALESCE(SUM(v_sign * (CASE WHEN jl.side = 'debit' THEN jl.amount ELSE -jl.amount END)), 0)
    INTO v_opening
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_id = p_account_id
    AND je.entry_date < p_from;

  -- 기간 내 라인 + 상대계정 + 누계 잔액
  WITH base AS (
    SELECT jl.id, je.id AS entry_id, je.entry_date, je.entry_no, je.description,
           jl.side, jl.amount, jl.note, jl.vendor_id,
           CASE WHEN jl.side = 'debit'  THEN jl.amount ELSE 0 END AS debit,
           CASE WHEN jl.side = 'credit' THEN jl.amount ELSE 0 END AS credit,
           v_sign * (CASE WHEN jl.side = 'debit' THEN jl.amount ELSE -jl.amount END) AS delta
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.account_id = p_account_id
      AND je.entry_date >= p_from
      AND je.entry_date <= p_to
  ),
  enriched AS (
    SELECT b.*,
           v.name AS vendor_name,
           (SELECT string_agg(DISTINCT a2.name, ', ')
              FROM journal_lines jl2
              JOIN accounts a2 ON a2.id = jl2.account_id
             WHERE jl2.journal_entry_id = b.entry_id
               AND jl2.side <> b.side) AS counterpart,
           v_opening + SUM(b.delta) OVER (
             ORDER BY b.entry_date, b.entry_no, b.id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS balance
    FROM base b
    LEFT JOIN vendors v ON v.id = b.vendor_id
  )
  SELECT jsonb_agg(jsonb_build_object(
           'entry_date',  entry_date,
           'entry_no',    entry_no,
           'description', description,
           'counterpart', counterpart,
           'vendor',      vendor_name,
           'debit',       debit,
           'credit',      credit,
           'balance',     balance,
           'note',        note
         ) ORDER BY entry_date, entry_no, id),
         COALESCE(SUM(debit), 0),
         COALESCE(SUM(credit), 0)
    INTO v_rows, v_total_debit, v_total_credit
  FROM enriched;

  RETURN jsonb_build_object(
    'account',      v_account,
    'opening',      v_opening,
    'rows',         COALESCE(v_rows, '[]'::jsonb),
    'total_debit',  v_total_debit,
    'total_credit', v_total_credit,
    'closing',      v_opening + v_sign * (v_total_debit - v_total_credit)
  );
END;
$$;

-- ── 거래처별 원장: 잔액 탭(거래처별 잔액 요약) ──────────────────────
CREATE OR REPLACE FUNCTION vendor_ledger_balances(
  p_from date,
  p_to   date
) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH agg AS (
    SELECT jl.vendor_id,
           SUM(CASE WHEN je.entry_date <  p_from
                    THEN (CASE WHEN jl.side = 'debit' THEN jl.amount ELSE -jl.amount END)
                    ELSE 0 END) AS opening,
           SUM(CASE WHEN je.entry_date BETWEEN p_from AND p_to AND jl.side = 'debit'
                    THEN jl.amount ELSE 0 END) AS period_debit,
           SUM(CASE WHEN je.entry_date BETWEEN p_from AND p_to AND jl.side = 'credit'
                    THEN jl.amount ELSE 0 END) AS period_credit,
           COUNT(*) FILTER (WHERE je.entry_date BETWEEN p_from AND p_to) AS period_count
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.vendor_id IS NOT NULL
      AND je.entry_date <= p_to
    GROUP BY jl.vendor_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'vendor_id',     a.vendor_id,
           'vendor_name',   v.name,
           'opening',       a.opening,
           'period_debit',  a.period_debit,
           'period_credit', a.period_credit,
           'closing',       a.opening + a.period_debit - a.period_credit,
           'period_count',  a.period_count
         ) ORDER BY v.name), '[]'::jsonb)
  FROM agg a
  JOIN vendors v ON v.id = a.vendor_id
  WHERE a.opening <> 0 OR a.period_count > 0;
$$;

-- ── 거래처별 원장: 내용 탭(특정 거래처 상세) ────────────────────────
CREATE OR REPLACE FUNCTION vendor_ledger_detail(
  p_vendor_id uuid,
  p_from      date,
  p_to        date
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_vendor       jsonb;
  v_opening      numeric;
  v_rows         jsonb;
  v_total_debit  numeric;
  v_total_credit numeric;
BEGIN
  SELECT jsonb_build_object('id', v.id, 'name', v.name)
    INTO v_vendor
  FROM vendors v WHERE v.id = p_vendor_id;

  IF v_vendor IS NULL THEN
    RETURN jsonb_build_object('error', '거래처를 찾을 수 없습니다.');
  END IF;

  -- 전월이월: (차변-대변) 누계, p_from 이전
  SELECT COALESCE(SUM(CASE WHEN jl.side = 'debit' THEN jl.amount ELSE -jl.amount END), 0)
    INTO v_opening
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.vendor_id = p_vendor_id
    AND je.entry_date < p_from;

  WITH base AS (
    SELECT jl.id, je.entry_date, je.entry_no, je.description, jl.account_id, jl.note,
           CASE WHEN jl.side = 'debit'  THEN jl.amount ELSE 0 END AS debit,
           CASE WHEN jl.side = 'credit' THEN jl.amount ELSE 0 END AS credit,
           (CASE WHEN jl.side = 'debit' THEN jl.amount ELSE -jl.amount END) AS delta
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.vendor_id = p_vendor_id
      AND je.entry_date >= p_from
      AND je.entry_date <= p_to
  ),
  enriched AS (
    SELECT b.*, a.code AS account_code, a.name AS account_name,
           v_opening + SUM(b.delta) OVER (
             ORDER BY b.entry_date, b.entry_no, b.id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS balance
    FROM base b
    LEFT JOIN accounts a ON a.id = b.account_id
  )
  SELECT jsonb_agg(jsonb_build_object(
           'entry_date',   entry_date,
           'entry_no',     entry_no,
           'description',  description,
           'account_code', account_code,
           'account_name', account_name,
           'debit',        debit,
           'credit',       credit,
           'balance',      balance,
           'note',         note
         ) ORDER BY entry_date, entry_no, id),
         COALESCE(SUM(debit), 0),
         COALESCE(SUM(credit), 0)
    INTO v_rows, v_total_debit, v_total_credit
  FROM enriched;

  RETURN jsonb_build_object(
    'vendor',       v_vendor,
    'opening',      v_opening,
    'rows',         COALESCE(v_rows, '[]'::jsonb),
    'total_debit',  v_total_debit,
    'total_credit', v_total_credit,
    'closing',      v_opening + (v_total_debit - v_total_credit)
  );
END;
$$;
