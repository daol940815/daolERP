-- =====================================================
-- 053_cleanup_card_test_rows.sql
-- 2026 카드결제내역 업로드 전 사전 정리.
--
-- 문제: 초기 테스트로 등록된 카드 사용내역 3건(2026-03-31, 하나카드)의
--   source_key 가 구버전 형식(마스킹 카드번호, 카드사 없음)이다.
--     구: '5376-****-****-2841|2026-03-31|09:39|19200|하남(만)휴게소...'
--     신: '하나카드|53762841|2026-03-31|09:39|19200|하남(만)휴게소...'
--   2026-01-01~06-30 파일을 올리면 같은 거래가 신 형식 키로 다시 들어와
--   중복 방지가 작동하지 못하고 → 사용내역·분개가 이중 등록된다.
--   마스킹 형식 카드계좌 3행도 숫자 정규화 행과 중복(좀비)이다.
--
-- 조치: 테스트 3건의 분개를 전기 취소(unpost)하고 행 삭제,
--   마스킹 형식 카드계좌 3행 삭제. (재업로드 시 신 형식으로 깨끗하게 재등록됨)
-- =====================================================

-- 1) 테스트 3건 분개 전기 취소 (멱등)
SELECT unpost_journal('card', id)
  FROM card_expenses
 WHERE source_key LIKE '%-****-%';   -- 구형식 키(마스킹 카드번호 포함)만

-- 2) 테스트 사용내역 3건 삭제
DELETE FROM card_expenses
 WHERE source_key LIKE '%-****-%';

-- 3) 마스킹 형식 카드계좌 삭제 (숫자 정규화 행이 이미 존재)
--    참조하는 사용내역이 남아있지 않은 행만 안전 삭제
DELETE FROM card_accounts ca
 WHERE ca.card_number LIKE '%*%'
   AND NOT EXISTS (SELECT 1 FROM card_expenses ce WHERE ce.card_account_id = ca.id);

-- 검증: 아래가 모두 0이어야 함
-- SELECT count(*) FROM card_expenses WHERE source_key LIKE '%-****-%';
-- SELECT count(*) FROM card_accounts WHERE card_number LIKE '%*%';
-- SELECT count(*) FROM journal_entries WHERE source_type='card';
