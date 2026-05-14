'use client'

import { clsx } from 'clsx'
import { ChevronLeft, ChevronRight, AlertCircle, Loader2 } from 'lucide-react'
import type { Transaction } from '@/types'
import { useStore } from '@/store/useStore'

interface Props {
  transactions: Transaction[]
  total: number
  page: number
  pages: number
  isLoading: boolean
  onSelectTransaction: (tx: Transaction) => void
  selectedId?: number
}

const TX_TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  deposit: { label: '입금', cls: 'text-emerald-400' },
  withdrawal: { label: '출금', cls: 'text-red-400' },
  card_purchase: { label: '카드', cls: 'text-violet-400' },
  card_cancel: { label: '취소', cls: 'text-yellow-400' },
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.abs(amount))
}

function formatDate(dateStr: string) {
  return dateStr.replace(/-/g, '.')
}

export default function TransactionTable({
  transactions,
  total,
  page,
  pages,
  isLoading,
  onSelectTransaction,
  selectedId,
}: Props) {
  const { setTransactionFilter } = useStore()

  return (
    <div className="erp-card flex flex-col flex-1 overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 py-2.5 border-b border-slate-700 flex items-center justify-between flex-shrink-0">
        <span className="text-sm text-slate-400">
          총 <span className="text-slate-200 font-medium">{total.toLocaleString()}</span>건
        </span>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <button
            disabled={page <= 1}
            onClick={() => setTransactionFilter({ page: page - 1 })}
            className="p-1 rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span>{page} / {pages || 1}</span>
          <button
            disabled={page >= pages}
            onClick={() => setTransactionFilter({ page: page + 1 })}
            className="p-1 rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 테이블 */}
      <div className="overflow-auto flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> 불러오는 중...
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-500 gap-2">
            <AlertCircle className="w-8 h-8" />
            <span>거래내역이 없습니다</span>
          </div>
        ) : (
          <table className="erp-table">
            <thead>
              <tr>
                <th>거래일</th>
                <th>기관</th>
                <th>계좌</th>
                <th>구분</th>
                <th>적요/가맹점</th>
                <th className="text-right">금액</th>
                <th className="text-right">잔액</th>
                <th>카테고리</th>
                <th>메모</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(tx => {
                const typeInfo = tx.transaction_type ? TX_TYPE_LABEL[tx.transaction_type] : null
                const isPositive = tx.amount > 0

                return (
                  <tr
                    key={tx.id}
                    onClick={() => onSelectTransaction(tx)}
                    className={clsx(
                      'cursor-pointer',
                      selectedId === tx.id && 'bg-blue-600/10 !border-blue-700/30'
                    )}
                  >
                    <td className="text-slate-400 text-xs">{formatDate(tx.transaction_date)}</td>
                    <td className="text-slate-300 text-xs">
                      {tx.account?.institution?.name ?? '-'}
                    </td>
                    <td className="text-slate-400 text-xs max-w-[100px] truncate">
                      {tx.account?.account_name || tx.account?.account_number || '-'}
                    </td>
                    <td>
                      {typeInfo ? (
                        <span className={clsx('text-xs font-medium', typeInfo.cls)}>
                          {typeInfo.label}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="max-w-[180px] truncate text-slate-200">
                      {tx.description || tx.counterparty || '-'}
                    </td>
                    <td className={clsx(
                      'text-right font-medium tabular-nums',
                      isPositive ? 'text-emerald-400' : 'text-red-400'
                    )}>
                      {isPositive ? '+' : '-'}{formatAmount(tx.amount)}
                    </td>
                    <td className="text-right text-slate-400 tabular-nums text-xs">
                      {tx.balance != null ? formatAmount(tx.balance) : '-'}
                    </td>
                    <td className="text-xs">
                      {tx.category ? (
                        <span className="px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
                          {tx.category}
                        </span>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="max-w-[120px] truncate text-slate-400 text-xs">
                      {tx.memo || '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
