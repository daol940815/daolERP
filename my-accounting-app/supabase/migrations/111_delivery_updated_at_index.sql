-- 운송장 조회: 여러 PC 간 변경분 동기화(/db/changes?since=…)가 갱신 시각으로 행을 찾으므로 색인 추가
-- (선택 사항 — 지금 규모에서는 없어도 빠르지만, 데이터가 늘어나도 조회가 가벼워짐)
CREATE INDEX IF NOT EXISTS delivery_items_updated_at_idx ON delivery_items (updated_at);
