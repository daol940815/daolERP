import PageTabs from '@/components/ui/PageTabs'
import ProfileClient, { type ProfileTab } from './profile-client'

// 내 정보 — 내 업무 › 내 정보. 기본 정보 / 계정 / 내 업무 요약 탭 (2026-10-01 시안 확정).
// 영역 공통(내 업무 그룹)이라 어느 영역에서든 같은 자리. 옛 /me/password 는 ?tab=account 로 리다이렉트.
export default function MyProfilePage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab: ProfileTab = searchParams.tab === 'account' ? 'account' : searchParams.tab === 'work' ? 'work' : 'basic'
  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">내 정보</h1>
      <p className="text-sm mt-1 text-gray-500">본인 정보와 계정, 내 업무 현황을 한곳에서 봅니다. 연락처와 비밀번호만 직접 바꿀 수 있습니다.</p>
      <PageTabs className="mt-3 mb-4" active={tab} tabs={[
        { key: 'basic', label: '기본 정보', href: '/me/profile' },
        { key: 'account', label: '계정', href: '/me/profile?tab=account' },
        { key: 'work', label: '내 업무 요약', href: '/me/profile?tab=work' },
      ]} />
      <ProfileClient tab={tab} />
    </div>
  )
}
