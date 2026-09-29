import AreaShell from '@/components/layout/AreaShell'

export const dynamic = 'force-dynamic'

// 영업·주문 영역 라우트 그룹(/me · /orders) — 공용 4영역 셸
export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  return <AreaShell>{children}</AreaShell>
}
