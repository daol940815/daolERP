'use client'

import { useState } from 'react'
import { X, Save, Clock } from 'lucide-react'
import { clsx } from 'clsx'
import type { Transaction } from '@/types'
import { useTransactionLogs, useUpdateTransaction } from '@/hooks/useTransactions'

interface Props {
  transaction: Transaction
  onClose: () => void
}

const CATEGORIES = [
  '급여', '임대료', '공과금', '통신비', '교통비', '식비', '접대비',
  '소모품', '복리후생', '광고비', '외주비', '세금', '보험료', '기타',
]

function formatAmount(amount: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.abs(amount))
}

export default function TransactionDetail({ transaction, onClose }: Props) {
  const { data: logs = [] } = useTransactionLogs(transaction.id)
  const updateMutation = useUpdateTransaction()

  const [category, setCategory] = useState(transaction.category || '')
  const [memo, setMemo] = useState(transaction.memo || '')
  const [counterparty, setCounterparty] = useState(transaction.counterparty || '')
  const [showLogs, setShowLogs] = useState(false)

  const handleSave = () => {
    updateMutation.mutate({
      id: transaction.id,
      data: {
        category: category || undefined,
        memo: memo || undefined,
        counterparty: counterparty || undefined,
      },
    }, {
      onSuccess: onClose,
    })
  }

  const isPositive = transaction.amount > 0

  return (
    <div className="erp-card flex flex-col overflow-hidden" style={{ minWidth: 300, maxWidth: 360 }}>
      {/* 헤더 */}
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between flex-shrink-0">
        <span className="text-sm font-medium text-slate-200">거래 상세</span>
        <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded text-slate-400">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="overflow-y-auto flex-1 p-4 space-y-4">
        {/* 금액 */}
        <div className="text-center py-3 border-b border-slate-700">
          <div className={clsx('text-3xl font-bold', isPositive ? 'text-emerald-400' : 'text-red-400')}>
            {isPositive ? '+' : '-'}{formatAmount(transaction.amount)}
            <span className="text-lg ml-1 font-normal">원</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">{transaction.transaction_date}</div>
        </div>

        {/* 기본 정보 */}
        <div className="space-y-2 text-sm">
          {[
            { label: '기관', value: transaction.account?.institution?.name },
            { label: '계좌', value: transaction.account?.account_name || transaction.account?.account_number },
            { label: '적요', value: transaction.description },
            { label: '잔액', value: transaction.balance != null ? `${formatAmount(transaction.balance)}원` : null },
          ].map(({ label, value }) => value ? (
            <div key={label} className="flex gap-2">
              <span className="text-slate-500 w-14 flex-shrink-0">{label}</span>
              <span className="text-slate-300">{value}</span>
            </div>
          ) : null)}
        </div>

        {/* 수정 가능 필드 */}
        <div className="space-y-3 border-t border-slate-700 pt-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">거래처</label>
            <input
              type="text"
              value={counterparty}
              onChange={e => setCounterparty(e.target.value)}
              className="erp-input w-full"
              placeholder="거래처명"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">카테고리</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="erp-input w-full"
            >
              <option value="">선택안함</option>
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">메모</label>
            <textarea
              value={memo}
              onChange={e => setMemo(e.target.value)}
              className="erp-input w-full resize-none"
              rows={2}
              placeholder="메모 입력..."
            />
          </div>
        </div>

        {/* 수정 이력 */}
        {logs.length > 0 && (
          <div className="border-t border-slate-700 pt-3">
            <button
              onClick={() => setShowLogs(v => !v)}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
            >
              <Clock className="w-3.5 h-3.5" />
              수정 이력 ({logs.length})
            </button>
            {showLogs && (
              <div className="mt-2 space-y-1.5">
                {logs.map(log => (
                  <div key={log.id} className="text-xs text-slate-500 bg-slate-800/50 rounded p-2">
                    <div className="text-slate-400 font-medium">{log.field_name}</div>
                    <div>{log.old_value} → {log.new_value}</div>
                    <div className="text-slate-600 mt-0.5">{new Date(log.changed_at).toLocaleString('ko-KR')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 저장 */}
      <div className="px-4 py-3 border-t border-slate-700 flex gap-2 flex-shrink-0">
        <button onClick={onClose} className="btn-secondary flex-1">취소</button>
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="btn-primary flex-1 flex items-center justify-center gap-1"
        >
          <Save className="w-3.5 h-3.5" />
          {updateMutation.isPending ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  )
}
