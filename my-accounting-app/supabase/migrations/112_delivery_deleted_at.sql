-- 운송장 조회: 삭제를 실제 삭제 대신 '삭제 표시'로 처리 (여러 PC 사용 시 삭제된 행이 되살아나는 문제 방지)
-- '' = 정상 행, ISO 시각 = 삭제된 시각. 목록·ID 대조에서 제외되며 30일 뒤 Workers 가 실제 삭제.
-- ※ 이 마이그레이션은 v0917-2 Workers 배포 전에 실행해야 합니다 (열이 없으면 불러오기가 실패함)
ALTER TABLE delivery_items ADD COLUMN IF NOT EXISTS deleted_at TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS delivery_items_deleted_at_idx ON delivery_items (deleted_at);
