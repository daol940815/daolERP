import Link from 'next/link'
import PageTabs from '@/components/ui/PageTabs'
import RequestsList from './requests-list'
import type { WrScope } from '@/lib/work-requests'

// 업무 요청 — 내 업무 그룹(전 영역 공통). 공용 목록(전체) / 내가 받은 / 내가 보낸 (900·901, docs/work-request-track.md)
// 2026-11-10: ?tag=<태그 id | none> — 업무 계열 태그 필터 미리 선택(경영 현황 드릴다운, 904)
// 2026-11-02: 목록 공용 전환 + '내 업무만' 버튼(받은·보낸). ?tab=all|inbox|outbox, ?month=, ?employee= (경영 현황 드릴다운)
export default function WorkRequestsPage({ searchParams }: { searchParams: { tab?: string; month?: string; employee?: string; filter?: string; tag?: string } }) {
  const scope: WrScope = searchParams.tab === 'all' ? 'all' : searchParams.tab === 'outbox' ? 'outbox' : 'inbox'
  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ month: searchParams.month, employee: searchParams.employee, ...extra })) if (v) p.set(k, v)
    const s = p.toString(); return s ? `?${s}` : ''
  }
  return (
    <div className="w-full">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">업무 요청</h1>
        <Link href="/me/requests/new" className="ml-auto px-3 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700">+ 새 요청</Link>
      </div>
      <PageTabs className="mt-3 mb-4" active={scope} tabs={[
        { key: 'inbox', label: '내가 받은', href: `/me/requests${q({ tab: undefined })}` },
        { key: 'outbox', label: '내가 보낸', href: `/me/requests${q({ tab: 'outbox' })}` },
        { key: 'all', label: '전체 (공용)', href: `/me/requests${q({ tab: 'all' })}` },
      ]} />
      <RequestsList scope={scope} month={searchParams.month} employee={searchParams.employee} initialFilter={searchParams.filter} initialTag={searchParams.tag} />
    </div>
  )
}
