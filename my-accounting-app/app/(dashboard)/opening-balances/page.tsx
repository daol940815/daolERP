import PageTabs from '@/components/ui/PageTabs'
import AccountTab from './account-tab'
import VendorTab from './vendor-tab'

// 기초잔액 — 계정 / 거래처 탭 통합 (2026-09-30 UI 2차 정리, 통합 후보 1)
// 옛 주소 /vendor-opening-balances 는 ?tab=vendor 로 리다이렉트된다.
export default function OpeningBalancesPage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab = searchParams.tab === 'vendor' ? 'vendor' : 'account'
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">기초잔액 (전기이월)</h1>
      <PageTabs className="mt-3 mb-4" active={tab} tabs={[
        { key: 'account', label: '계정과목', href: '/opening-balances' },
        { key: 'vendor', label: '거래처', href: '/opening-balances?tab=vendor' },
      ]} />
      {tab === 'vendor' ? <VendorTab /> : <AccountTab />}
    </div>
  )
}
