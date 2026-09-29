import AreaShell from '@/components/layout/AreaShell'

export const dynamic = 'force-dynamic'

// 근태·휴가 화면(/hr/*) — 내 근태는 영업·주문 영역, 근태 현황·휴가 승인은 인사·총무 영역.
// 어느 영역 사이드바를 보일지는 AreaShell이 경로·권한·마지막 선택으로 판정한다.
export default function HrLayout({ children }: { children: React.ReactNode }) {
  return <AreaShell>{children}</AreaShell>
}
