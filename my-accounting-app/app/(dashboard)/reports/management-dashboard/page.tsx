import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// 경영대시보드는 통합 대시보드의 '경영 지표' 탭으로 합쳐졌다 (2026-08-25).
// 기존 링크·북마크가 끊기지 않도록 기간 파라미터를 유지한 채 넘긴다.
export default function ManagementDashboardRedirect({
  searchParams,
}: { searchParams?: { from?: string; to?: string; period?: string } }) {
  const p = new URLSearchParams()
  p.set('tab', 'mgmt')
  if (searchParams?.from) p.set('from', searchParams.from)
  if (searchParams?.to) p.set('to', searchParams.to)
  if (searchParams?.period) p.set('period', searchParams.period)
  redirect(`/?${p.toString()}`)
}
