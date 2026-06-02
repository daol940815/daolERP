import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import { createAdminClient } from '@/lib/supabase-server'
import type { BankAccount } from '@/types/bank-account'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('bank_accounts')
    .select('id, bank_name, account_number, alias, is_active, created_at, updated_at')
    .eq('is_active', true)
    .order('bank_name')

  const initialBanks: BankAccount[] = (data ?? []).map(b => ({
    ...b,
    current_balance: null,
    balance_date: null,
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
