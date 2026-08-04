import { redirect } from 'next/navigation'

// 근태 화면은 직원 관리 모드로 이동 — 기존 주소 호환용 리다이렉트
export default function OrdersAttendanceRedirect() {
  redirect('/hr/attendance')
}
