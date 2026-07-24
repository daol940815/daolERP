-- =====================================================
-- 069_crm_core.sql
-- 매출처 고객관리(CRM) 핵심 테이블
-- 설계: docs/customer-management-design.md (v1.1 §3, §9)
--
-- 원칙:
-- - CRM은 기존 회계 데이터(분개/원장/수금/정산)에 쓰기를 하지 않는다.
-- - erp_order_items에는 FK/컬럼을 일절 두지 않는다 (재업로드 시 삭제·재생성되므로).
--   귀속 정보는 주문(erp_orders) 레벨과 crm_* 테이블에만 둔다.
-- =====================================================

-- ── 1) 명절 마스터 ────────────────────────────────────
-- order_start/end는 엑셀 원장(24~26)의 구분별 주문일 분포로 산정한
-- "주문 수집 기간". 날짜 기반 시즌 추천에만 쓰며 확정은 사용자가 한다.
CREATE TABLE IF NOT EXISTS crm_seasons (
  code         VARCHAR(10) PRIMARY KEY,   -- '24설', '25추석' … (엑셀 구분값 그대로)
  label        VARCHAR(50) NOT NULL,
  season_type  VARCHAR(10) NOT NULL CHECK (season_type IN ('seol', 'chuseok')),
  year         SMALLINT    NOT NULL,
  order_start  DATE        NOT NULL,
  order_end    DATE        NOT NULL
);

INSERT INTO crm_seasons (code, label, season_type, year, order_start, order_end) VALUES
  ('24설',   '2024년 설',   'seol',    2024, '2024-01-01', '2024-03-15'),
  ('24추석', '2024년 추석', 'chuseok', 2024, '2024-08-01', '2024-10-15'),
  ('25설',   '2025년 설',   'seol',    2025, '2024-12-15', '2025-03-15'),
  ('25추석', '2025년 추석', 'chuseok', 2025, '2025-08-15', '2025-11-15'),
  ('26설',   '2026년 설',   'seol',    2026, '2026-01-01', '2026-03-15'),
  ('26추석', '2026년 추석', 'chuseok', 2026, '2026-08-15', '2026-11-15')
ON CONFLICT (code) DO NOTHING;

-- ── 2) 고객(사람) 마스터 ─────────────────────────────
CREATE TABLE IF NOT EXISTS crm_contacts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id       UUID REFERENCES vendors(id) ON DELETE SET NULL,
  bank_name       VARCHAR(100) NOT NULL,   -- 현재 소속 (표시용, 식별은 id)
  branch_name     VARCHAR(100),
  name            VARCHAR(100) NOT NULL,   -- 성함 ('안아영')
  title           VARCHAR(50),             -- 직급 ('차장')
  role            VARCHAR(20) NOT NULL DEFAULT 'staff'
                  CHECK (role IN ('staff', 'branch_manager')),
  phone           VARCHAR(50),
  office_phone    VARCHAR(50),
  intimacy_grade  CHAR(1) CHECK (intimacy_grade IN ('A','B','C','D')),  -- 수기 입력
  keyman          VARCHAR(200),            -- 키맨(소개 루트)
  is_rotc         BOOLEAN,                 -- NULL = 미확인
  counselor_prev  VARCHAR(50),             -- 상담자(기존) — 엑셀 이관값 보존
  counselor_now   VARCHAR(50),             -- 상담자(현재) — 다올 담당 영업
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'moved', 'left', 'merged')),
  merged_into_id  UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  memo            TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_vendor ON crm_contacts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_bank   ON crm_contacts(bank_name, branch_name);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_name   ON crm_contacts(name);

-- ── 3) 주문 매칭 키 (학습 — erp_vendor_aliases 패턴) ──
-- 주문 원문(은행|지점|담당자) 3요소를 고객에 연결. 한 사람이 여러 키를
-- 가질 수 있다(오타 표기·직급 변경·지점 이동 전후). 병합 시 키는 남기고
-- contact_id만 승계한다.
CREATE TABLE IF NOT EXISTS crm_contact_keys (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id    UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  bank_name     VARCHAR(100) NOT NULL,           -- 주문 원문 그대로
  branch_name   VARCHAR(100) NOT NULL DEFAULT '', -- 주문 branch NULL은 ''로 정규화
  manager_name  VARCHAR(100) NOT NULL,           -- 원문 그대로 ('안아영 차장님')
  source        VARCHAR(10) NOT NULL DEFAULT 'manual'
                CHECK (source IN ('import', 'manual', 'auto')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (bank_name, branch_name, manager_name)
);

CREATE INDEX IF NOT EXISTS idx_crm_keys_contact ON crm_contact_keys(contact_id);

-- ── 4) 관리 활동 이력 ────────────────────────────────
-- 고객의 "최종 관리일"은 MAX(activity_date)로 파생한다 (컬럼 중복 보관 금지).
CREATE TABLE IF NOT EXISTS crm_activities (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id       UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  activity_date    DATE NOT NULL,
  activity_type    VARCHAR(20) NOT NULL
                   CHECK (activity_type IN ('call','visit','kakao','gift','sample','order_followup','etc')),
  staff_name       VARCHAR(50),
  summary          VARCHAR(300),
  memo             TEXT,
  next_action_date DATE,
  next_action_memo VARCHAR(300),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_activities_contact ON crm_activities(contact_id, activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_next    ON crm_activities(next_action_date)
  WHERE next_action_date IS NOT NULL;

-- ── 5) 등급 스냅샷 (월 1회 보존 — 추이·재현성) ───────
CREATE TABLE IF NOT EXISTS crm_grade_snapshots (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id       UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  eval_month       VARCHAR(7) NOT NULL,   -- 'YYYY-MM'
  revenue_grade    CHAR(1) NOT NULL,
  continuity_grade CHAR(1) NOT NULL,
  intimacy_grade   CHAR(1),
  overall_grade    CHAR(1) NOT NULL,
  total_revenue    BIGINT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (contact_id, eval_month)
);

CREATE INDEX IF NOT EXISTS idx_crm_snapshots_month ON crm_grade_snapshots(eval_month);

-- ── 6) 엑셀 과거 매출 집계 (DB 미보유 기간: 2024년) ──
-- erp_orders는 2025-01-01~ 만 보유. 연속성 등급(최근 3개년)과 2025 신규/이탈
-- 판정에 필요한 2024년 매출을 엑셀 원장에서 고객×버킷 집계로 1회 이관.
-- 라인이 아닌 집계값이므로 drill-down은 "엑셀 이관값" 배지로만 표시한다.
CREATE TABLE IF NOT EXISTS crm_legacy_sales (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id   UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  season_code  VARCHAR(10) REFERENCES crm_seasons(code),  -- 명절 버킷
  sales_month  VARCHAR(7),                                -- 상시 버킷 'YYYY-MM'
  amount       BIGINT NOT NULL,
  source       VARCHAR(50) NOT NULL DEFAULT 'excel-2024',
  created_at   TIMESTAMPTZ DEFAULT now(),
  CHECK ((season_code IS NULL) <> (sales_month IS NULL))
);

-- 부분 유니크 (season/month 어느 쪽이 NULL이어도 중복 방지)
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_legacy_season
  ON crm_legacy_sales(contact_id, season_code) WHERE season_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_legacy_month
  ON crm_legacy_sales(contact_id, sales_month) WHERE sales_month IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_legacy_contact ON crm_legacy_sales(contact_id);

-- ── 7) erp_orders 확장 (nullable 컬럼 2개 — 기존 화면·RPC 무영향) ──
-- 재업로드 upsert(onConflict: order_no)는 임포트가 보내는 컬럼만 갱신하므로
-- 이 컬럼들은 보존된다. 단, 키 3요소가 바뀐 주문은 crm_match_orders가 재평가한다.
ALTER TABLE erp_orders
  ADD COLUMN IF NOT EXISTS season_code    VARCHAR(10) REFERENCES crm_seasons(code),
  ADD COLUMN IF NOT EXISTS crm_contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_erp_orders_crm_contact ON erp_orders(crm_contact_id);
CREATE INDEX IF NOT EXISTS idx_erp_orders_season      ON erp_orders(season_code);
-- 매칭 조인용 (3만+ 행 재매칭 성능)
CREATE INDEX IF NOT EXISTS idx_erp_orders_match_key
  ON erp_orders(bank_name, branch_name, manager_name);

-- ── 8) updated_at 트리거 (공용 함수 재사용) ──────────
DROP TRIGGER IF EXISTS trg_crm_contacts_updated_at ON crm_contacts;
CREATE TRIGGER trg_crm_contacts_updated_at
  BEFORE UPDATE ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_crm_activities_updated_at ON crm_activities;
CREATE TRIGGER trg_crm_activities_updated_at
  BEFORE UPDATE ON crm_activities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 9) RLS (064 관례: 활성화만, 정책 없음 — 접근은 서버 API service_role) ──
ALTER TABLE crm_seasons         ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contact_keys    ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activities      ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_grade_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_legacy_sales    ENABLE ROW LEVEL SECURITY;

-- ── 10) merge_vendor 확장 — crm_contacts.vendor_id 승계 ──
-- 055 본문 그대로 + crm_contacts 1줄 추가 (설계 §9-4).
CREATE OR REPLACE FUNCTION merge_vendor(p_from UUID, p_into UUID, p_actor TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_from vendors%ROWTYPE;
  v_into vendors%ROWTYPE;
  n_tx INT; n_jl INT; n_ti INT; n_cs INT; n_cr INT; n_ca INT; n_al INT; n_vl INT;
  n_crm INT;
  v_ob_from BIGINT; refs JSONB;
BEGIN
  IF p_from = p_into THEN RAISE EXCEPTION '같은 거래처입니다'; END IF;
  SELECT * INTO v_from FROM vendors WHERE id = p_from;
  SELECT * INTO v_into FROM vendors WHERE id = p_into;
  IF v_from.id IS NULL OR v_into.id IS NULL THEN RAISE EXCEPTION '거래처를 찾을 수 없습니다'; END IF;
  IF v_into.status <> 'active' THEN RAISE EXCEPTION '대표 거래처가 active 상태가 아닙니다'; END IF;
  IF v_from.status = 'merged' THEN RAISE EXCEPTION '이미 병합된 거래처입니다'; END IF;

  UPDATE transactions        SET vendor_id = p_into WHERE vendor_id = p_from;  GET DIAGNOSTICS n_tx = ROW_COUNT;
  UPDATE journal_lines       SET vendor_id = p_into WHERE vendor_id = p_from;  GET DIAGNOSTICS n_jl = ROW_COUNT;
  UPDATE tax_invoices        SET vendor_id = p_into WHERE vendor_id = p_from;  GET DIAGNOSTICS n_ti = ROW_COUNT;
  UPDATE card_sales          SET vendor_id = p_into WHERE vendor_id = p_from;  GET DIAGNOSTICS n_cs = ROW_COUNT;
  UPDATE cash_receipts       SET vendor_id = p_into WHERE vendor_id = p_from;  GET DIAGNOSTICS n_cr = ROW_COUNT;
  UPDATE card_accounts       SET vendor_id = p_into WHERE vendor_id = p_from;  GET DIAGNOSTICS n_ca = ROW_COUNT;
  UPDATE erp_vendor_aliases  SET vendor_id = p_into WHERE vendor_id = p_from;  GET DIAGNOSTICS n_al = ROW_COUNT;
  UPDATE vendor_ledger_entries SET vendor_id = p_into WHERE vendor_id = p_from; GET DIAGNOSTICS n_vl = ROW_COUNT;
  UPDATE crm_contacts        SET vendor_id = p_into WHERE vendor_id = p_from;  GET DIAGNOSTICS n_crm = ROW_COUNT;

  -- 기초잔액(vendor_id PK): from 잔액을 into에 합산 후 from 행 제거
  SELECT amount INTO v_ob_from FROM vendor_opening_balances WHERE vendor_id = p_from;
  IF v_ob_from IS NOT NULL THEN
    INSERT INTO vendor_opening_balances(vendor_id, amount)
    VALUES (p_into, v_ob_from)
    ON CONFLICT (vendor_id) DO UPDATE SET amount = vendor_opening_balances.amount + EXCLUDED.amount;
    DELETE FROM vendor_opening_balances WHERE vendor_id = p_from;
  END IF;

  -- 흡수: 이름/별칭/카드번호를 대표의 별칭으로 (중복 제거, 학습)
  UPDATE vendors SET
    match_aliases = (
      SELECT COALESCE(array_agg(DISTINCT a), '{}')
      FROM unnest(COALESCE(v_into.match_aliases,'{}') || COALESCE(v_from.match_aliases,'{}') || ARRAY[v_from.name]) AS a
      WHERE a IS NOT NULL AND a <> '' AND a <> v_into.name
    ),
    card_numbers = (
      SELECT COALESCE(array_agg(DISTINCT c), '{}')
      FROM unnest(COALESCE(v_into.card_numbers,'{}') || COALESCE(v_from.card_numbers,'{}')) AS c
      WHERE c IS NOT NULL AND c <> ''
    ),
    biz_number = COALESCE(v_into.biz_number, v_from.biz_number),
    is_card_company = v_into.is_card_company OR v_from.is_card_company
  WHERE id = p_into;

  UPDATE vendors SET status = 'merged', merged_into_id = p_into, is_active = false WHERE id = p_from;

  refs := jsonb_build_object(
    'transactions', n_tx, 'journal_lines', n_jl, 'tax_invoices', n_ti,
    'card_sales', n_cs, 'cash_receipts', n_cr, 'card_accounts', n_ca,
    'erp_vendor_aliases', n_al, 'vendor_ledger_entries', n_vl,
    'crm_contacts', n_crm,
    'opening_balance_moved', COALESCE(v_ob_from, 0));
  INSERT INTO vendor_merge_logs(actor, kind, from_id, from_name, into_id, into_name, moved_refs)
  VALUES (p_actor, 'vendor', p_from, v_from.name, p_into, v_into.name, refs);
  RETURN refs;
END;
$$;
