-- =====================================================
-- 506_consultations.sql
-- 상담일지 — 실물 '주문상담' 시트의 ERP 이관 (사용자 확정 2026-08-11)
--
-- 실무 흐름: 상담 내용 기록 → 주문 확정 시 주문서로 전환 (이중 입력 제거).
-- 구조: 상담 1건(erp_consultations) + 품목 N행(erp_consultation_items).
--  - erp_orders에 초안으로 넣지 않음 — 하류(허브·회계) 집계 오염 방지
--  - 업체·지점·담당자는 마스터 FK + 자유 텍스트 병기 (상담 단계는 신규 고객
--    가능 — 마스터 강제하지 않음. 주문 전환 시점에 마스터 등록 안내)
--  - 결제정보는 앱 레벨 AES-256-GCM 암호화 저장 (PAYMENT_ENC_KEY 환경변수),
--    화면은 마스킹 표시 (사용자 확정)
--  - 조회는 기본 본인 작성분만, manager/admin 전체 (사용자 확정)
--  - 저장 시 영업일지(contact_activities)에 '상담' 활동 자동 기재
--    (담당자가 마스터 인물일 때만 — 인물 기준 구조)
-- =====================================================

-- ── 1) 상담일지 본문 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_consultations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consult_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  consult_type   TEXT NOT NULL DEFAULT '문의'
                 CHECK (consult_type IN ('주문', '문의', '요청', '결제', '기타')),
  -- 고객처 — 마스터 연결(선택) + 표기 텍스트(자유 입력 겸용)
  vendor_group_id UUID REFERENCES vendor_groups(id) ON DELETE SET NULL,
  vendor_id      UUID REFERENCES vendors(id)       ON DELETE SET NULL,
  contact_id     UUID REFERENCES contacts(id)      ON DELETE SET NULL,
  bank_name      TEXT,                    -- 업체(은행) 표기
  branch_name    TEXT,                    -- 부서(지점) 표기
  manager_name   TEXT,                    -- 담당자 표기 (직함 포함)
  phone          TEXT,                    -- 핸드폰
  tel            TEXT,                    -- 연락처(유선)
  -- 상담 부가 (실물 컬럼)
  product_status TEXT,                    -- 상태 (품절·단종·단가변경 등)
  option_note    TEXT,                    -- 색상, 옵션 등 기타사항
  payment_info_enc TEXT,                  -- 결제정보 (AES-256-GCM 암호문, 앱 레벨)
  sender_name    TEXT,                    -- 보내는분 명의
  delivery_request TEXT,                  -- 배송요청일 (자유 표기: "9/16" 등)
  greeting_card  TEXT,                    -- 인사장·명함
  address_checked TEXT,                   -- 주소확인여부
  roster_method  TEXT,                    -- 고객명단수단
  memo           TEXT,                    -- 메모 (감사 문구 등)
  -- 상태·작성자
  status         TEXT NOT NULL DEFAULT '진행중'
                 CHECK (status IN ('진행중', '주문전환', '종결')),
  employee_id    UUID REFERENCES employees(id) ON DELETE SET NULL,  -- 작성자 (본인 조회 기준)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consult_employee ON erp_consultations(employee_id, consult_date DESC);
CREATE INDEX IF NOT EXISTS idx_consult_status   ON erp_consultations(status);

DROP TRIGGER IF EXISTS trg_consultations_updated_at ON erp_consultations;
CREATE TRIGGER trg_consultations_updated_at
  BEFORE UPDATE ON erp_consultations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2) 상담 품목 (주문 품목과 같은 필드 구성 — 전환 시 그대로 이동) ──
CREATE TABLE IF NOT EXISTS erp_consultation_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id      UUID NOT NULL REFERENCES erp_consultations(id) ON DELETE CASCADE,
  line_no              SMALLINT NOT NULL,
  product_id           UUID REFERENCES erp_products(id) ON DELETE SET NULL,
  item_code            VARCHAR(50),
  item_name            VARCHAR(300),
  order_kind           VARCHAR(20),          -- 지점/개별/샘플
  purchase_vendor_name VARCHAR(200),
  sale_price           BIGINT DEFAULT 0,
  quantity             INTEGER DEFAULT 0,
  shipping_fee         BIGINT DEFAULT 0,
  discount_amount      BIGINT DEFAULT 0,
  line_total           BIGINT DEFAULT 0,
  purchase_price       BIGINT DEFAULT 0,
  purchase_shipping    BIGINT DEFAULT 0,
  purchase_total       BIGINT DEFAULT 0,
  memo                 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (consultation_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_consult_items ON erp_consultation_items(consultation_id);

-- ── 3) 주문 ↔ 상담 연결 (상담 1건 → 주문 N건 허용) ────
ALTER TABLE erp_orders
  ADD COLUMN IF NOT EXISTS consultation_id UUID REFERENCES erp_consultations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_erp_orders_consult ON erp_orders(consultation_id) WHERE consultation_id IS NOT NULL;

COMMENT ON COLUMN erp_orders.consultation_id IS '이 주문의 근거가 된 상담일지. 상담 1건에서 여러 주문 전환 가능.';

-- ── 4) 영업일지 활동 유형에 '상담' 추가 ───────────────
ALTER TABLE contact_activities DROP CONSTRAINT IF EXISTS contact_activities_activity_type_check;
ALTER TABLE contact_activities ADD CONSTRAINT contact_activities_activity_type_check
  CHECK (activity_type IN ('방문', '전화', '미팅', '식사', '제안', '상담', '기타'));

-- ── RLS (서비스 키 경유 API만 접근) ───────────────────
ALTER TABLE erp_consultations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_consultation_items ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE erp_consultations IS
  '상담일지 — 주문의 느슨한 초안 + 상담 기록. 주문 전환 시 erp_orders.consultation_id로 연결되고 상태가 주문전환으로 바뀐다.';
