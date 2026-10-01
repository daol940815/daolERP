import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/user-role'
import { createAdminClient } from '@/lib/supabase-server'
import { areasFor } from '@/lib/permissions'
import { AREA_COOKIE, areaLabel, groupsFor, homeFor, pathAccessible, pickArea } from '@/lib/area-shell'
import AreaSidebar from './AreaSidebar'
import Header from './Header'
import type { BankAccount } from '@/types/bank-account'

// 4영역 공용 셸 — 세 라우트 그룹((dashboard)·(orders)·(hr))의 레이아웃이 모두 이것을 쓴다.
// 1) 로그인·근무 종료 확인 → 2) 경로 접근 권한(URL 직접 접근 차단) → 3) 영역 판정 → 사이드바.
// 현재 경로는 미들웨어가 넣어 준 x-pathname 헤더로 읽는다.
export default async function AreaShell({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser()
  if (!me) redirect('/login')
  if (me.expired) redirect('/login?reason=expired')

  const pathname = headers().get('x-pathname') ?? '/'
  if (!pathAccessible(me, pathname)) redirect(homeFor(me))

  const area = pickArea(me, pathname, cookies().get(AREA_COOKIE)?.value)
  const groups = groupsFor(me, area)

  // 회계·재무 영역만 계좌 목록을 서버에서 미리 넘긴다 (통장 내역 하위 바로가기)
  let initialBanks: BankAccount[] = []
  if (area === 'finance') {
    const { data } = await createAdminClient()
      .from('bank_accounts')
      .select('id, bank_name, account_number, alias, is_active, account_type, overdraft_limit, created_at, updated_at')
      .eq('is_active', true)
      .order('bank_name')
    initialBanks = (data ?? []).map(b => ({
      ...b, current_balance: null, balance_date: null, overdraft_used: null, overdraft_available: null,
    }))
  }

  const userSub = [me.team, me.isMaster ? '마스터' : null].filter(Boolean).join(' · ')

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <AreaSidebar
        area={area}
        areaLabel={areaLabel(area)}
        groups={groups}
        userName={me.employeeName ?? me.email ?? '사용자'}
        userSub={userSub}
        showAreaSelect={areasFor(me).length >= 2}
        initialBanks={initialBanks}
      />
      <div className="flex flex-col flex-1 overflow-hidden">
        {(area === 'finance' || area === 'mgmt') && <Header />}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
