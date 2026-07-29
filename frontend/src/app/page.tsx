'use client'

import { useState } from 'react'
import MainLayout from '@/components/layout/MainLayout'
import TransactionFilter from '@/components/features/transactions/TransactionFilter'
import TransactionTable from '@/components/features/transactions/TransactionTable'
import TransactionDetail from '@/components/features/transactions/TransactionDetail'
import { useTransactions } from '@/hooks/useTransactions'
import { useStore } from '@/store/useStore'
import type { Transaction } from '@/types'

export default function HomePage() {
  const { transactionFilter } = useStore()
  const { data, isLoading } = useTransactions(transactionFilter)
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null)

  return (
    <MainLayout>
      <div className="flex flex-col h-full gap-3">
        <div className="flex items-center justify-between flex-shrink-0">
          <h1 className="text-base font-semibold text-slate-200">거래내역 통합 조회</h1>
        </div>

        <TransactionFilter />

        <div className="flex gap-3 flex-1 min-h-0">
          <div className="flex-1 min-w-0">
            <TransactionTable
              transactions={data?.items ?? []}
              total={data?.total ?? 0}
              page={data?.page ?? 1}
              pages={data?.pages ?? 1}
              isLoading={isLoading}
              onSelectTransaction={setSelectedTx}
              selectedId={selectedTx?.id}
            />
          </div>

          {selectedTx && (
            <TransactionDetail
              transaction={selectedTx}
              onClose={() => setSelectedTx(null)}
            />
          )}
        </div>
      </div>
    </MainLayout>
  )
}
