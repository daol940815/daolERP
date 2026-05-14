'use client'

import { useState } from 'react'
import { Search, X, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { useStore } from '@/store/useStore'
import { useInstitutions, useAccounts } from '@/hooks/useTransactions'

const TX_TYPES = [
  { value: '', label: '전체 유형' },
  { value: 'deposit', label: '입금' },
  { value: 'withdrawal', label: '출금' },
  { value: 'card_purchase', label: '카드결제' },
  { value: 'card_cancel', label: '카드취소' },
]

export default function TransactionFilter() {
  const { transactionFilter, setTransactionFilter, resetTransactionFilter } = useStore()
  const { data: institutions = [] } = useInstitutions()
  const { data: accounts = [] } = useAccounts(transactionFilter.institution_id)
  const [keyword, setKeyword] = useState(transactionFilter.keyword || '')

  const handleKeywordSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setTransactionFilter({ keyword: keyword || undefined })
  }

  const hasActiveFilter = !!(
    transactionFilter.institution_id ||
    transactionFilter.account_id ||
    transactionFilter.transaction_type ||
    transactionFilter.date_from ||
    transactionFilter.date_to ||
    transactionFilter.keyword
  )

  return (
    <div className="erp-card p-3 flex flex-wrap items-center gap-2">
      {/* 검색 */}
      <form onSubmit={handleKeywordSubmit} className="flex items-center gap-1">
        <input
          type="text"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          placeholder="적요, 거래처, 메모 검색..."
          className="erp-input w-52"
        />
        <button type="submit" className="btn-ghost px-2">
          <Search className="w-4 h-4" />
        </button>
      </form>

      {/* 기관 */}
      <select
        value={transactionFilter.institution_id || ''}
        onChange={e => setTransactionFilter({
          institution_id: e.target.value ? Number(e.target.value) : undefined,
          account_id: undefined,
        })}
        className="erp-input"
      >
        <option value="">전체 기관</option>
        {institutions.map(i => (
          <option key={i.id} value={i.id}>{i.name}</option>
        ))}
      </select>

      {/* 계좌 */}
      {accounts.length > 0 && (
        <select
          value={transactionFilter.account_id || ''}
          onChange={e => setTransactionFilter({
            account_id: e.target.value ? Number(e.target.value) : undefined,
          })}
          className="erp-input"
        >
          <option value="">전체 계좌</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>
              {a.account_name || a.account_number || `계좌 #${a.id}`}
            </option>
          ))}
        </select>
      )}

      {/* 거래 유형 */}
      <select
        value={transactionFilter.transaction_type || ''}
        onChange={e => setTransactionFilter({
          transaction_type: e.target.value || undefined,
        })}
        className="erp-input"
      >
        {TX_TYPES.map(t => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      {/* 날짜 범위 */}
      <input
        type="date"
        value={transactionFilter.date_from || ''}
        onChange={e => setTransactionFilter({ date_from: e.target.value || undefined })}
        className="erp-input"
      />
      <span className="text-slate-600 text-sm">~</span>
      <input
        type="date"
        value={transactionFilter.date_to || ''}
        onChange={e => setTransactionFilter({ date_to: e.target.value || undefined })}
        className="erp-input"
      />

      {/* 초기화 */}
      {hasActiveFilter && (
        <button
          onClick={() => {
            resetTransactionFilter()
            setKeyword('')
          }}
          className="btn-ghost flex items-center gap-1 text-red-400 hover:text-red-300"
        >
          <X className="w-3.5 h-3.5" />
          초기화
        </button>
      )}
    </div>
  )
}
