import { getCurrentUser } from '@/lib/user-role'
import PageTabs from '@/components/ui/PageTabs'
import HelpClient from './help-client'

// 도움말 — 내 업무 › 도움말 (도움말 트랙 1차, 2026-11-03). 전체 도움말 목록(검색) / 점검(마스터: 항목 상태 · 미작성 · 최근 질문).
// 화면별 패널(HelpLauncher)과 같은 help-registry 를 읽는다.
export default async function HelpPage({ searchParams }: { searchParams: { tab?: string; q?: string } }) {
  const me = await getCurrentUser()
  const master = !!me?.isMaster
  const tab = searchParams.tab === 'audit' && master ? 'audit' : 'list'
  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">도움말</h1>
      <p className="text-sm text-gray-500 mt-1">화면마다 오른쪽 위 &quot;도움말&quot; 버튼으로도 같은 내용을 볼 수 있습니다. 해결이 안 되면 질문하기 — 업무 요청으로 담당자에게 갑니다.</p>
      {master && (
        <PageTabs className="mt-3 mb-4" active={tab} tabs={[
          { key: 'list', label: '전체 목록', href: '/me/help' },
          { key: 'audit', label: '점검 (마스터)', href: '/me/help?tab=audit' },
        ]} />
      )}
      <HelpClient tab={tab} initialQuery={searchParams.q ?? ''} />
    </div>
  )
}
