import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/user-role'
import { areasFor } from '@/lib/permissions'
import LogoutButton from './logout-button'
import CheckWidget from '@/app/(orders)/orders/check-widget'

export const dynamic = 'force-dynamic'

// 업무 선택 — 권한이 있는 영역만 카드로(제목만). 영역이 하나뿐이면 이 화면 없이 바로 진입.
// 카드는 /api/area/select 를 거쳐 마지막 선택 영역을 쿠키에 남기고 그 영역 홈으로 간다.
export default async function PortalPage() {
  const me = await getCurrentUser()
  if (!me) redirect('/login')
  if (me.expired) redirect('/login?reason=expired')

  const areas = areasFor(me)
  if (areas.length === 0) redirect('/login?reason=noaccess')
  if (areas.length === 1) redirect(`/api/area/select?area=${areas[0].key}`)

  const name = me.employeeName ?? me.email ?? '사용자'

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4">
      <h1 className="text-white text-2xl font-bold">업무 선택</h1>
      <p className="text-slate-400 text-sm mt-2">{name} 님</p>

      {/* 출근·퇴근 체크 — 로그인 직후 영역에 들어가지 않고도 (2026-10-01 사용자 요청). 비대상 직원에게는 비표시 */}
      <div className="mt-6 w-64"><CheckWidget /></div>

      <div className="flex gap-4 mt-8 flex-wrap justify-center">
        {areas.map(a => (
          <Link key={a.key} href={`/api/area/select?area=${a.key}`}
            className="flex items-center justify-center bg-white rounded-2xl w-52 h-28 text-lg font-bold text-slate-900 hover:-translate-y-0.5 hover:shadow-xl transition-all">
            {a.label}
          </Link>
        ))}
      </div>

      <div className="mt-10">
        <LogoutButton />
      </div>
    </div>
  )
}
