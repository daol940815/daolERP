-- 113: 직원별 화면 설정 (글자 크기 · 색 테마) — 총괄 세션, UI 재조정 트랙 (docs/ui-reorg-track.md "화면 설정")
--
-- 사용자 결정(2026-11-05): 개인 UI 설정은 글자 크기 · UI 색상만. 계정에 저장해 어느 PC에서 로그인해도 같게.
-- 값은 표시에만 쓰인다 — 계산 · 기간 기본값 · 권한과 무관. 형식: {"fontScale": "sm"|"md"|"lg", "theme": "default"|"navy"|"green"|"warm"}
-- 모르는 값은 화면이 무시하고 기본값으로 본다(테마를 없애도 안전).

ALTER TABLE employees ADD COLUMN IF NOT EXISTS ui_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN employees.ui_prefs IS '화면 설정(본인만 수정): fontScale sm|md|lg · theme default|navy|green|warm. 표시 전용.';

-- 검증 (실행 후 결과 확인)
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'ui_prefs') AS ui_prefs_열_기대1,
  (SELECT count(*) FROM employees WHERE ui_prefs IS NULL) AS 빈값_기대0;
