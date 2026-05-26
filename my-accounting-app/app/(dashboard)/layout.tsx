// (dashboard) 라우트 그룹 레이아웃
// 로그인 페이지를 제외한 모든 내부 페이지에 사이드바 + 헤더 적용
// 괄호(()) 이름은 URL에 영향을 주지 않음
// force-dynamic: 인증 상태에 따라 매 요청마다 서버에서 렌더링

import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'

export const dynamic = 'force-dynamic'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* 좌측 사이드바 */}
      <Sidebar />

      {/* 우측: 헤더 + 콘텐츠 */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
