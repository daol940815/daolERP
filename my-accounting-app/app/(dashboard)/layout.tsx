import AreaShell from '@/components/layout/AreaShell'

export const dynamic = 'force-dynamic'

// 회계·재무 / 경영 현황 / 인사·총무(직원·계정) 화면 라우트 그룹 — 공용 4영역 셸.
// 접근 권한·영역 판정·사이드바는 AreaShell이 담당한다.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AreaShell>{children}</AreaShell>
}
