import { redirect } from 'next/navigation'

// 직원 관리 모드 홈 — 내 근태로 이동
export default function HrHomePage() {
  redirect('/hr/attendance')
}
