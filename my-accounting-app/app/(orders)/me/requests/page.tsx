import Link from 'next/link'
import PageTabs from '@/components/ui/PageTabs'
import RequestsList from './requests-list'

// 업무 요청 — 내 업무 그룹(전 영역 공통). 받은 요청 / 보낸 요청 탭 (900, docs/work-request-track.md)
export default function WorkRequestsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const box = searchParams.tab === 'outbox' ? 'outbox' : 'inbox'
  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">업무 요청</h1>
        <Link href="/me/requests/new" className="ml-auto px-3 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700">+ 새 요청</Link>
      </div>
      <PageTabs className="mt-3 mb-4" active={box} tabs={[
        { key: 'inbox', label: '받은 요청', href: '/me/requests' },
        { key: 'outbox', label: '보낸 요청', href: '/me/requests?tab=outbox' },
      ]} />
      <RequestsList box={box} />
    </div>
  )
}
