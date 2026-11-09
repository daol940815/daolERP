-- =====================================================
-- 116_contact_tel.sql
-- 거래처 담당자 유선 번호 — 사용자 승인 2026-11-09 (상담·영업·업무일지 트랙 세션에서 접수한 문의)
--
-- 배경: 상담일지(phone·tel)와 주문(phone·contact)은 담당자 연락처를 문서마다 저장하지만, 인물 마스터
-- contacts에는 핸드폰(phone) 한 칸뿐이라 유선 번호는 이어지지 않았고, 문서에 적은 핸드폰도 마스터로
-- 돌아가지 않아 다음 상담·주문에서 다시 빈칸이 됐다.
--
-- 설계: contacts에 tel(유선) 추가. 상담·주문 저장 시 담당자가 마스터에 연결돼 있고 마스터 칸이
-- **비어 있으면** 입력한 번호를 채운다(기확정 값은 덮어쓰지 않는다 — lib/contact-phone-sync.ts).
-- 다르면 화면에 "마스터 번호와 다름"만 표시한다.
-- =====================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tel TEXT;
COMMENT ON COLUMN contacts.tel IS '유선 번호(직통). 핸드폰은 phone. 상담·주문 저장 시 비어 있으면 자동 채움 (116).';

-- 검증: 유선컬럼_기대1 = 1
SELECT count(*) AS "유선컬럼_기대1"
  FROM information_schema.columns
 WHERE table_name = 'contacts' AND column_name = 'tel';
