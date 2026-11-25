import PageTabs from '@/components/ui/PageTabs'
import StatusTab from './status-tab'
import GrantsTab from './grants-tab'
import YearEndTab from './yearend-tab'

// 연차 관리 (207, 2026-11-18 — 시안 docs/mockups/연차관리_시안.html)
// 현황: 엑셀 "연차일수" 시트와 같은 표 / 부여 내역: 기본 · 보상 · 이월 · 조정 원장 / 연말 · 연초 정리: 기본 연차 · 이월 추천 → 확정
export default function LeaveBalancePage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab = searchParams.tab === 'grants' ? 'grants' : searchParams.tab === 'yearend' ? 'yearend' : 'status'
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">연차 관리</h1>
      <p className="text-sm mt-1 text-slate-600">
        직원별 연차 부여 · 사용 · 잔여입니다. 사용은 승인된 연차 · 반차 · 병가에서 자동으로 계산되고(공가 · 무급휴가 · 기타는 제외),
        기본 연차를 먼저 쓰고 넘치면 보상 연차에서 뺍니다. 남은 기본 연차는 연말에 소멸하고 보상 연차만 다음 해로 넘어갑니다.
      </p>
      <PageTabs className="mt-3 mb-4" active={tab} tabs={[
        { key: 'status', label: '현황', href: '/hr/leave-balance' },
        { key: 'grants', label: '부여 내역', href: '/hr/leave-balance?tab=grants' },
        { key: 'yearend', label: '연말 · 연초 정리', href: '/hr/leave-balance?tab=yearend' },
      ]} />
      {tab === 'grants' ? <GrantsTab /> : tab === 'yearend' ? <YearEndTab /> : <StatusTab />}
    </div>
  )
}
