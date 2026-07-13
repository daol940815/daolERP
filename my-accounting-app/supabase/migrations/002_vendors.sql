-- =====================================================
-- 002_vendors.sql
-- 거래처(Vendor/Customer) 테이블
-- 매출/매입 등 거래 상대방 정보를 저장
-- =====================================================

CREATE TABLE IF NOT EXISTS vendors (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  -- 거래처명 (예: (주)다올, 카카오모빌리티)
  name          VARCHAR(200) NOT NULL,
  -- 사업자등록번호 (선택 입력, 형식: 000-00-00000)
  biz_number    VARCHAR(20),
  -- 거래처 유형: vendor(매입처), customer(매출처), both(양쪽 모두)
  type          VARCHAR(20)  DEFAULT 'vendor' CHECK (type IN ('vendor', 'customer', 'both')),
  -- 담당자 이름
  contact_name  VARCHAR(100),
  -- 담당자 연락처
  contact_phone VARCHAR(50),
  -- 이메일 주소
  email         VARCHAR(200),
  -- 메모 / 특이사항
  note          TEXT,
  -- 활성 여부
  is_active     BOOLEAN      DEFAULT true,
  created_at    TIMESTAMPTZ  DEFAULT now(),
  updated_at    TIMESTAMPTZ  DEFAULT now()
);

-- 거래처명 검색을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_vendors_name ON vendors(name);

-- 사업자등록번호 조회를 위한 인덱스 (중복 체크 등)
CREATE INDEX IF NOT EXISTS idx_vendors_biz_number ON vendors(biz_number);

-- 활성 거래처만 조회하기 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_vendors_is_active ON vendors(is_active);

-- updated_at 자동 갱신 트리거
DROP TRIGGER IF EXISTS trg_vendors_updated_at ON vendors;
CREATE TRIGGER trg_vendors_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
