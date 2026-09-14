-- 109: 송장번호 입력 시각 기록 (배송지연 경과일 기준 통일용)
-- 경과일 기준: 집화 시각(shipped_at) → 송장번호 입력일(num_added_at) → 행 등록일(added_at)
-- ★ 반드시 index.html 교체 전에 실행할 것 — 새 프로그램은 이 열에 저장을 시도하므로
--   열이 없으면 모든 저장이 실패함

ALTER TABLE delivery_items ADD COLUMN IF NOT EXISTS num_added_at TEXT NOT NULL DEFAULT '';

-- 기존에 송장번호가 있는 행은 입력 시각을 알 수 없으므로 행 등록일로 채움
-- (대부분 등록 시 송장이 함께 들어오므로 실질적으로 정확)
UPDATE delivery_items SET num_added_at = COALESCE(added_at, '')
WHERE num <> '' AND num_added_at = '';
