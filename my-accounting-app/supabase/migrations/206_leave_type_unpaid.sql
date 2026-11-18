-- =====================================================
-- 206_leave_type_unpaid.sql
-- 인사·총무 트랙 — 휴가 종류에 무급휴가 추가
--
-- 2026-11-18 사용자 결정: 무급휴가를 휴가 종류로 새로 만든다(기존 엑셀은 "무급" 글자로 표시).
-- 무급휴가 · 경조(공가) · 예비군(공가)은 연차에서 차감하지 않는다. 차감은 연차 · 오전 반차 · 오후 반차만.
-- 근태 판정에서는 다른 종일 휴가와 같이 "휴가"로 표시된다(결근 아님).
-- =====================================================

ALTER TABLE attendance_leaves DROP CONSTRAINT IF EXISTS attendance_leaves_leave_type_check;
ALTER TABLE attendance_leaves ADD CONSTRAINT attendance_leaves_leave_type_check
  CHECK (leave_type IN ('annual', 'half_am', 'half_pm', 'sick', 'official', 'unpaid', 'other'));
