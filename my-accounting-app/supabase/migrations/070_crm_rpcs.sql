-- =====================================================
-- 070_crm_rpcs.sql
-- CRM 매칭·등급·신규이탈·병합 RPC
-- 설계: docs/customer-management-design.md (v1.1 §4)
--
-- 등급 규칙 (2026-07-23 사장님 확정):
-- - 매출 인정 라인: 취소·VIP·선결제·샘플 제외 + 품명 퀵/택배비/배송비 제외
-- - 매출등급: 최근 3개년 누적 A ≥ 1,000만 / B ≥ 500만 / C ≥ 100만 / D
-- - 연속성: 엑셀 수식 계승, "24~26 고정" 대신 기준연도(y0) 기준 최근 3개년
-- - 종합: A=4~D=1 평균 반올림. 친밀도 미입력 시 매출·연속성 2개 평균
--   (주의: 엑셀 원본은 미입력을 D(1점) 취급 — 검증 시 이 차이를 분리 보고)
-- =====================================================

-- ── 1) 매출 인정 라인 뷰 ─────────────────────────────
-- CRM 매출 집계의 유일한 기준. erp_order_items의 id는 재업로드마다 바뀌므로
-- 뷰는 매번 현재 상태를 계산할 뿐 아무것도 저장하지 않는다.
CREATE OR REPLACE VIEW crm_sales_lines AS
SELECT
  o.crm_contact_id            AS contact_id,
  o.id                        AS order_id,
  o.order_date,
  o.season_code,
  i.line_total                AS amount
FROM erp_order_items i
JOIN erp_orders o ON o.id = i.order_id
WHERE o.crm_contact_id IS NOT NULL
  AND NOT i.is_canceled
  AND NOT i.is_vip
  AND NOT i.is_prepayment
  AND COALESCE(i.order_kind, '') <> '샘플'
  AND COALESCE(i.item_name, '') NOT LIKE '%퀵%'
  AND COALESCE(i.item_name, '') NOT LIKE '%택배비%'
  AND COALESCE(i.item_name, '') NOT LIKE '%배송비%';

-- ── 2) 고객×연도×버킷 집계 뷰 (erp + 엑셀 이관 UNION) ─
-- btype: 'season'(명절) / 'regular'(상시)
CREATE OR REPLACE VIEW crm_contact_buckets AS
SELECT
  l.contact_id,
  COALESCE(s.year, EXTRACT(YEAR FROM l.order_date)::SMALLINT) AS year,
  CASE WHEN l.season_code IS NOT NULL THEN 'season' ELSE 'regular' END AS btype,
  SUM(l.amount) AS amount
FROM crm_sales_lines l
LEFT JOIN crm_seasons s ON s.code = l.season_code
GROUP BY 1, 2, 3
UNION ALL
SELECT
  g.contact_id,
  COALESCE(s.year, LEFT(g.sales_month, 4)::SMALLINT) AS year,
  CASE WHEN g.season_code IS NOT NULL THEN 'season' ELSE 'regular' END AS btype,
  SUM(g.amount) AS amount
FROM crm_legacy_sales g
LEFT JOIN crm_seasons s ON s.code = g.season_code
GROUP BY 1, 2, 3;

-- ── 3) 주문 ↔ 고객 매칭 (멱등 — 전체 재유도) ─────────
-- "빈 것만 채우기"가 아니라 매번 키에서 다시 유도한다:
-- 재업로드로 은행/지점/담당자명이 바뀐 주문도 올바르게 재평가되고,
-- 키가 없어진 주문은 귀속이 해제된다.
CREATE OR REPLACE FUNCTION crm_match_orders()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  n_set INT; n_cleared INT; n_unmatched INT;
BEGIN
  -- 키와 일치하는 주문: contact 지정/교체
  UPDATE erp_orders o
  SET crm_contact_id = k.contact_id
  FROM crm_contact_keys k
  WHERE k.bank_name    = COALESCE(o.bank_name, '')
    AND k.branch_name  = COALESCE(o.branch_name, '')
    AND k.manager_name = COALESCE(o.manager_name, '')
    AND o.crm_contact_id IS DISTINCT FROM k.contact_id;
  GET DIAGNOSTICS n_set = ROW_COUNT;

  -- 어떤 키와도 일치하지 않는데 귀속이 남은 주문: 해제
  UPDATE erp_orders o
  SET crm_contact_id = NULL
  WHERE o.crm_contact_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM crm_contact_keys k
      WHERE k.bank_name    = COALESCE(o.bank_name, '')
        AND k.branch_name  = COALESCE(o.branch_name, '')
        AND k.manager_name = COALESCE(o.manager_name, '')
    );
  GET DIAGNOSTICS n_cleared = ROW_COUNT;

  SELECT COUNT(DISTINCT (COALESCE(bank_name,''), COALESCE(branch_name,''), COALESCE(manager_name,'')))
  INTO n_unmatched
  FROM erp_orders WHERE crm_contact_id IS NULL;

  RETURN jsonb_build_object('set', n_set, 'cleared', n_cleared, 'unmatched_keys', n_unmatched);
END;
$$;

-- ── 4) 미귀속 주문 키 목록 (매칭 화면용) ─────────────
CREATE OR REPLACE FUNCTION crm_unmatched_keys()
RETURNS TABLE (
  bank_name TEXT, branch_name TEXT, manager_name TEXT,
  order_count BIGINT, total_amount BIGINT, first_date DATE, last_date DATE
)
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(o.bank_name, '')    AS bank_name,
    COALESCE(o.branch_name, '')  AS branch_name,
    COALESCE(o.manager_name, '') AS manager_name,
    COUNT(*)                     AS order_count,
    COALESCE(SUM(o.total_amount), 0)::BIGINT AS total_amount,
    MIN(o.order_date)            AS first_date,
    MAX(o.order_date)            AS last_date
  FROM erp_orders o
  WHERE o.crm_contact_id IS NULL
  GROUP BY 1, 2, 3
  ORDER BY total_amount DESC;
$$;

-- ── 5) 고객별 등급 통계 (엑셀 통계 시트의 대체) ──────
-- p_ref_year: 기준연도(y0). 미지정 시 오늘 기준. 평가 창 = y0-2 ~ y0.
CREATE OR REPLACE FUNCTION crm_contact_stats(p_ref_year INT DEFAULT NULL)
RETURNS TABLE (
  contact_id       UUID,
  total_revenue    BIGINT,
  revenue_grade    CHAR(1),
  continuity_grade CHAR(1),
  intimacy_grade   CHAR(1),
  overall_grade    CHAR(1),
  traded_y2        BOOLEAN,   -- y0-2년 거래 여부
  traded_y1        BOOLEAN,
  traded_y0        BOOLEAN,
  last_order_date  DATE,
  last_activity    DATE
)
LANGUAGE sql STABLE
AS $$
  WITH ref AS (
    SELECT COALESCE(p_ref_year, EXTRACT(YEAR FROM CURRENT_DATE)::INT) AS y0
  ),
  b AS (  -- 고객×연도별 명절/상시 합계 (평가 창 3개년만)
    SELECT
      cb.contact_id,
      SUM(CASE WHEN cb.year = r.y0-2 AND cb.btype = 'season'  THEN cb.amount ELSE 0 END) AS szn2,
      SUM(CASE WHEN cb.year = r.y0-1 AND cb.btype = 'season'  THEN cb.amount ELSE 0 END) AS szn1,
      SUM(CASE WHEN cb.year = r.y0   AND cb.btype = 'season'  THEN cb.amount ELSE 0 END) AS szn0,
      SUM(CASE WHEN cb.year = r.y0-2 AND cb.btype = 'regular' THEN cb.amount ELSE 0 END) AS reg2,
      SUM(CASE WHEN cb.year = r.y0-1 AND cb.btype = 'regular' THEN cb.amount ELSE 0 END) AS reg1,
      SUM(CASE WHEN cb.year = r.y0   AND cb.btype = 'regular' THEN cb.amount ELSE 0 END) AS reg0
    FROM crm_contact_buckets cb, ref r
    WHERE cb.year BETWEEN r.y0-2 AND r.y0
    GROUP BY cb.contact_id
  ),
  last_order AS (
    SELECT l.contact_id, MAX(l.order_date) AS d FROM crm_sales_lines l GROUP BY 1
  ),
  last_act AS (
    SELECT a.contact_id, MAX(a.activity_date) AS d FROM crm_activities a GROUP BY 1
  ),
  graded AS (
    SELECT
      c.id AS contact_id,
      COALESCE(b.szn2+b.szn1+b.szn0+b.reg2+b.reg1+b.reg0, 0)::BIGINT AS total_revenue,
      -- 매출등급
      CASE
        WHEN COALESCE(b.szn2+b.szn1+b.szn0+b.reg2+b.reg1+b.reg0, 0) >= 10000000 THEN 'A'
        WHEN COALESCE(b.szn2+b.szn1+b.szn0+b.reg2+b.reg1+b.reg0, 0) >=  5000000 THEN 'B'
        WHEN COALESCE(b.szn2+b.szn1+b.szn0+b.reg2+b.reg1+b.reg0, 0) >=  1000000 THEN 'C'
        ELSE 'D'
      END::CHAR(1) AS revenue_grade,
      -- 연속성 (엑셀 AW 수식의 일반화)
      CASE
        WHEN COALESCE(b.szn2,0)>0 AND COALESCE(b.szn1,0)>0 AND COALESCE(b.szn0,0)>0
         AND COALESCE(b.reg2,0)>0 AND COALESCE(b.reg1,0)>0 AND COALESCE(b.reg0,0)>0 THEN 'A'
        WHEN COALESCE(b.szn0,0)>0 AND COALESCE(b.reg0,0)>0 THEN 'B'
        WHEN (COALESCE(b.szn2,0)>0 AND COALESCE(b.szn1,0)>0 AND COALESCE(b.szn0,0)>0)
          OR (COALESCE(b.reg2,0)>0 AND COALESCE(b.reg1,0)>0 AND COALESCE(b.reg0,0)>0)
          OR COALESCE(b.szn0,0)>0 OR COALESCE(b.reg0,0)>0 THEN 'C'
        ELSE 'D'
      END::CHAR(1) AS continuity_grade,
      c.intimacy_grade,
      COALESCE(b.szn2,0)+COALESCE(b.reg2,0) > 0 AS traded_y2,
      COALESCE(b.szn1,0)+COALESCE(b.reg1,0) > 0 AS traded_y1,
      COALESCE(b.szn0,0)+COALESCE(b.reg0,0) > 0 AS traded_y0,
      lo.d AS last_order_date,
      la.d AS last_activity
    FROM crm_contacts c
    LEFT JOIN b          ON b.contact_id = c.id
    LEFT JOIN last_order lo ON lo.contact_id = c.id
    LEFT JOIN last_act   la ON la.contact_id = c.id
    WHERE c.status <> 'merged'
  )
  SELECT
    g.contact_id, g.total_revenue, g.revenue_grade, g.continuity_grade, g.intimacy_grade,
    -- 종합: A=4~D=1 평균 반올림. 친밀도 미입력이면 2개 평균 (확정 규칙)
    CASE ROUND((
        (CASE g.revenue_grade    WHEN 'A' THEN 4 WHEN 'B' THEN 3 WHEN 'C' THEN 2 ELSE 1 END)
      + (CASE g.continuity_grade WHEN 'A' THEN 4 WHEN 'B' THEN 3 WHEN 'C' THEN 2 ELSE 1 END)
      + COALESCE((CASE g.intimacy_grade WHEN 'A' THEN 4 WHEN 'B' THEN 3 WHEN 'C' THEN 2 WHEN 'D' THEN 1 END), 0)
      )::NUMERIC / (CASE WHEN g.intimacy_grade IS NULL THEN 2 ELSE 3 END))
      WHEN 4 THEN 'A' WHEN 3 THEN 'B' WHEN 2 THEN 'C' ELSE 'D'
    END::CHAR(1) AS overall_grade,
    g.traded_y2, g.traded_y1, g.traded_y0, g.last_order_date, g.last_activity
  FROM graded g;
$$;

-- ── 6) 신규/이탈 ─────────────────────────────────────
-- 신규(Y) = Y-1 미거래 & Y 거래 / 이탈(Y) = Y-1 거래 & Y 미거래
CREATE OR REPLACE FUNCTION crm_new_churn(p_year INT)
RETURNS TABLE (contact_id UUID, kind TEXT)
LANGUAGE sql STABLE
AS $$
  WITH t AS (
    SELECT
      cb.contact_id,
      SUM(CASE WHEN cb.year = p_year - 1 THEN cb.amount ELSE 0 END) > 0 AS prev_traded,
      SUM(CASE WHEN cb.year = p_year     THEN cb.amount ELSE 0 END) > 0 AS cur_traded
    FROM crm_contact_buckets cb
    WHERE cb.year IN (p_year - 1, p_year)
    GROUP BY cb.contact_id
  )
  SELECT t.contact_id, 'new'   AS kind FROM t WHERE NOT t.prev_traded AND t.cur_traded
  UNION ALL
  SELECT t.contact_id, 'churn' AS kind FROM t WHERE t.prev_traded AND NOT t.cur_traded;
$$;

-- ── 7) 등급 스냅샷 저장 (월 1회, 멱등 upsert) ────────
CREATE OR REPLACE FUNCTION crm_snapshot_grades(p_eval_month VARCHAR DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_month VARCHAR(7) := COALESCE(p_eval_month, TO_CHAR(CURRENT_DATE, 'YYYY-MM'));
  n INT;
BEGIN
  INSERT INTO crm_grade_snapshots
    (contact_id, eval_month, revenue_grade, continuity_grade, intimacy_grade, overall_grade, total_revenue)
  SELECT s.contact_id, v_month, s.revenue_grade, s.continuity_grade, s.intimacy_grade,
         s.overall_grade, s.total_revenue
  FROM crm_contact_stats(LEFT(v_month, 4)::INT) s
  ON CONFLICT (contact_id, eval_month) DO UPDATE SET
    revenue_grade    = EXCLUDED.revenue_grade,
    continuity_grade = EXCLUDED.continuity_grade,
    intimacy_grade   = EXCLUDED.intimacy_grade,
    overall_grade    = EXCLUDED.overall_grade,
    total_revenue    = EXCLUDED.total_revenue;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('eval_month', v_month, 'rows', n);
END;
$$;

-- ── 8) 고객(사람) 병합 ───────────────────────────────
-- 키·활동·주문 귀속·과거 매출을 대표로 승계, from은 merged로 표시.
-- 스냅샷은 이력이므로 원 소유자에 남긴다. 로그는 vendor_merge_logs 재사용(kind='crm_contact').
CREATE OR REPLACE FUNCTION crm_merge_contacts(p_from UUID, p_into UUID, p_actor TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  c_from crm_contacts%ROWTYPE;
  c_into crm_contacts%ROWTYPE;
  n_keys INT; n_act INT; n_orders INT; n_legacy INT;
  refs JSONB;
BEGIN
  IF p_from = p_into THEN RAISE EXCEPTION '같은 고객입니다'; END IF;
  SELECT * INTO c_from FROM crm_contacts WHERE id = p_from;
  SELECT * INTO c_into FROM crm_contacts WHERE id = p_into;
  IF c_from.id IS NULL OR c_into.id IS NULL THEN RAISE EXCEPTION '고객을 찾을 수 없습니다'; END IF;
  IF c_into.status = 'merged' THEN RAISE EXCEPTION '대표 고객이 이미 병합된 상태입니다'; END IF;
  IF c_from.status = 'merged' THEN RAISE EXCEPTION '이미 병합된 고객입니다'; END IF;

  UPDATE crm_contact_keys SET contact_id = p_into WHERE contact_id = p_from;
  GET DIAGNOSTICS n_keys = ROW_COUNT;
  UPDATE crm_activities   SET contact_id = p_into WHERE contact_id = p_from;
  GET DIAGNOSTICS n_act = ROW_COUNT;
  UPDATE erp_orders       SET crm_contact_id = p_into WHERE crm_contact_id = p_from;
  GET DIAGNOSTICS n_orders = ROW_COUNT;

  -- 과거 매출 승계: 부분 유니크가 버킷별로 2개라 명절/월을 각각 upsert (충돌 시 합산)
  INSERT INTO crm_legacy_sales (contact_id, season_code, sales_month, amount, source)
  SELECT p_into, g.season_code, NULL, g.amount, g.source
  FROM crm_legacy_sales g WHERE g.contact_id = p_from AND g.season_code IS NOT NULL
  ON CONFLICT (contact_id, season_code) WHERE season_code IS NOT NULL
  DO UPDATE SET amount = crm_legacy_sales.amount + EXCLUDED.amount;
  GET DIAGNOSTICS n_legacy = ROW_COUNT;

  INSERT INTO crm_legacy_sales (contact_id, season_code, sales_month, amount, source)
  SELECT p_into, NULL, g.sales_month, g.amount, g.source
  FROM crm_legacy_sales g WHERE g.contact_id = p_from AND g.sales_month IS NOT NULL
  ON CONFLICT (contact_id, sales_month) WHERE sales_month IS NOT NULL
  DO UPDATE SET amount = crm_legacy_sales.amount + EXCLUDED.amount;

  DELETE FROM crm_legacy_sales WHERE contact_id = p_from;

  -- 빈 필드는 from 값으로 보강 (기존 값 우선)
  UPDATE crm_contacts SET
    intimacy_grade = COALESCE(c_into.intimacy_grade, c_from.intimacy_grade),
    phone          = COALESCE(c_into.phone,          c_from.phone),
    office_phone   = COALESCE(c_into.office_phone,   c_from.office_phone),
    keyman         = COALESCE(c_into.keyman,         c_from.keyman),
    is_rotc        = COALESCE(c_into.is_rotc,        c_from.is_rotc),
    counselor_prev = COALESCE(c_into.counselor_prev, c_from.counselor_prev),
    counselor_now  = COALESCE(c_into.counselor_now,  c_from.counselor_now)
  WHERE id = p_into;

  UPDATE crm_contacts SET status = 'merged', merged_into_id = p_into WHERE id = p_from;

  refs := jsonb_build_object(
    'contact_keys', n_keys, 'activities', n_act, 'erp_orders', n_orders, 'legacy_sales', n_legacy);
  INSERT INTO vendor_merge_logs(actor, kind, from_id, from_name, into_id, into_name, moved_refs)
  VALUES (p_actor, 'crm_contact', p_from,
          c_from.bank_name || '/' || COALESCE(c_from.branch_name,'') || '/' || c_from.name,
          p_into,
          c_into.bank_name || '/' || COALESCE(c_into.branch_name,'') || '/' || c_into.name,
          refs);
  RETURN refs;
END;
$$;
