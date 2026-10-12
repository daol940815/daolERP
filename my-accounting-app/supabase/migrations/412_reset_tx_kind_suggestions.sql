-- =====================================================
-- 412_reset_tx_kind_suggestions.sql  (회계 트랙 — 1회성 데이터 정리)
-- 은행 구분(tx_kind) Step 0가 잘못 붙인 추천 초기화 (2026-10-12)
--
-- 사고: Step 0가 적요용 키워드를 구분 값에도 정확 일치시켜, '인터넷'(인터넷뱅킹 채널)이
--   통신비 적요 키워드 '인터넷'에 걸렸다. 우리 마이너스통장(…358607)의 자사 계좌 간 이체
--   38건 등이 통신비로 추천됨. 코드는 수정(구분 키워드 '구분:' 접두 이름공간 + 채널 값 제외).
-- 조치: Step 0가 붙인 추천(ai_reason = '은행 구분: …')만 비운다. **확정된 행은 손대지 않는다.**
--   비운 뒤 통장 내역 화면에서 자동분류를 다시 돌리면 적요 키워드 규칙으로 재추천된다.
-- =====================================================

-- ── STEP 1. 드라이런 (읽기 전용) ─────────────────────────
-- 어떤 구분 값이 어느 계정으로 몇 건 추천됐는지. 확정(confirmed) 행은 대상에서 빠진다.
SELECT t.tx_kind                                   AS 구분,
       a.code || ' ' || a.name                     AS 추천계정,
       COUNT(*)                                    AS 건수,
       COUNT(*) FILTER (WHERE t.status = 'pending' AND t.confirmed_account_id IS NULL) AS 초기화대상,
       COUNT(*) FILTER (WHERE t.status <> 'pending' OR t.confirmed_account_id IS NOT NULL) AS 이미확정_제외,
       SUM(t.amount_in) AS 입금, SUM(t.amount_out) AS 출금
FROM transactions t
LEFT JOIN accounts a ON a.id = t.suggested_account_id
WHERE t.ai_reason LIKE '은행 구분:%'
GROUP BY 1, 2
ORDER BY 3 DESC;

-- ── STEP 2. 초기화 (미확정 행만) ─────────────────────────
UPDATE transactions
SET suggested_account_id = NULL,
    suggested_side       = NULL,
    ai_confidence        = NULL,
    ai_reason            = NULL
WHERE ai_reason LIKE '은행 구분:%'
  AND status = 'pending'
  AND confirmed_account_id IS NULL;

-- ── STEP 3. 검증 (실행 후) ──────────────────────────────
-- 기대: 남은_구분추천_미확정 0  (확정된 행에 남아 있는 것은 사용자가 확인한 것이므로 그대로)
SELECT
  COUNT(*) FILTER (WHERE status = 'pending' AND confirmed_account_id IS NULL) AS 남은_구분추천_미확정,
  COUNT(*) FILTER (WHERE status <> 'pending' OR confirmed_account_id IS NOT NULL) AS 확정된_구분추천
FROM transactions
WHERE ai_reason LIKE '은행 구분:%';
