-- =====================================================
-- 415_transfer_pairs_reviewed.sql  (회계 트랙 — 1회성 데이터 정리)
-- 이미 묶인 계좌 간 이체쌍을 '검토완료'로 올린다 (2026-10-22)
--
-- 설계 공백: 이체쌍(transfer_pair_id)은 분개 대상이 아니라 확정·추천 수락 경로가 전부
-- 건너뛰었다 → 어떤 버튼을 눌러도 미검토에 남았다. 코드 수정: 이체 매칭 시 검토완료,
-- 추천 수락·선택 확정도 이체 행은 상태만 올린다(분개 없음). 이 파일은 기존 행 소급분.
-- 키워드가 붙여둔 추천(보통예금 등)은 의미가 없으므로 비운다. 확정된 행은 손대지 않는다.
-- =====================================================

-- ── STEP 1. 드라이런 ─────────────────────────────────────
SELECT
  COUNT(*)                                                     AS 이체쌍_행,
  COUNT(*) FILTER (WHERE status = 'pending')                   AS 미검토,
  COUNT(*) FILTER (WHERE status = 'reviewed')                  AS 검토완료,
  COUNT(*) FILTER (WHERE status = 'confirmed')                 AS 확정,
  COUNT(*) FILTER (WHERE status = 'pending' AND suggested_account_id IS NOT NULL) AS 미검토_중_추천있음,
  COUNT(*) FILTER (WHERE status = 'pending' AND confirmed_account_id IS NOT NULL) AS 미검토_중_계정있음
FROM transactions
WHERE transfer_pair_id IS NOT NULL;

-- ── STEP 2. 소급 ─────────────────────────────────────────
UPDATE transactions
SET status = 'reviewed',
    suggested_account_id = NULL, suggested_side = NULL, ai_confidence = NULL,
    ai_reason = '계좌 간 이체쌍 — 분개 대상 아님'
WHERE transfer_pair_id IS NOT NULL
  AND status = 'pending';

-- ── STEP 3. 검증 ─────────────────────────────────────────
-- 기대: 미검토_이체쌍 0
SELECT COUNT(*) AS 미검토_이체쌍
FROM transactions WHERE transfer_pair_id IS NOT NULL AND status = 'pending';
