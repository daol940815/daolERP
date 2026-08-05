import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { redirect } from 'next/navigation'
import type { BankAccount } from '@/types/bank-account'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // admin 외 역할은 회계·경영 모드 접근 불가 → 직원 워크스페이스(내 대시보드)로
  // 역할 확인과 은행계좌 조회는 서로 독립이므로 병렬 실행 (순차 왕복 제거)
  const admin = createAdminClient()
  const [me, { data }] = await Promise.all([
    getCurrentUser(),
    admin
      .from('bank_accounts')
      .select('id, bank_name, account_number, alias, is_active, account_type, overdraft_limit, created_at, updated_at')
      .eq('is_active', true)
      .order('bank_name'),
  ])
  if (me && me.role !== 'admin') redirect('/me')

  const initialBanks: BankAccount[] = (data ?? []).map(b => ({
    ...b,
    current_balance: null,
    balance_date: null,
    overdraft_used: null,
    overdraft_available: null,
  }))

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar initialBanks={initialBanks} />

      <div className="flex flex-col flex-1 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
