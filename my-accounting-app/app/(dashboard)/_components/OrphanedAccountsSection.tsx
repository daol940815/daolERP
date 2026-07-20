'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface OrphanedGroup {
  alias: string
  count: number
  totalIn: number
  totalOut: number
}

function fmt(n: number) {
  return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('ko-KR') + '원'
}

export default function OrphanedAccountsSection({ groups }: { groups: OrphanedGroup[] }) {
  const router = useRouter()
  const [registering, setRegistering] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  if (!groups.length) return null

  const handleRegister = async (alias: string) => {
    setRegistering(alias)
    setErrors(e => ({ ...e, [alias]: '' }))

    const res = await fetch('/api/bank-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bank_name: alias }),
    })
    const json = await res.json()
    setRegistering(null)

    if (!res.ok) {
      setErrors(e => ({ ...e, [alias]: json.error ?? '등록 실패' }))
      return
    }
    // 페이지 새로고침 → 방금 등록한 계좌가 계좌별 현황에 표시
    router.refresh()
  }

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-sm font-semibold text-amber-700">계좌 미연결 거래</h2>
        <span className="text-xs text-slate-400">{groups.length}개 계좌명 감지됨</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        아래 이름으로 거래가 업로드됐지만 계좌 레코드가 없어 대시보드에 표시되지 않습니다.
        <strong className="text-slate-600"> 계좌 등록</strong>을 클릭하면 기존 거래가 자동 연결되고 계좌별 현황에 추가됩니다.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {groups.map(({ alias, count, totalIn, totalOut }) => (
          <div
            key={alias}
            className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-slate-800 text-sm truncate">{alias}</p>
                <p className="text-xs text-slate-500">{count.toLocaleString()}건 미연결</p>
              </div>
              <button
                onClick={() => handleRegister(alias)}
                disabled={registering === alias}
                className="shrink-0 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {registering === alias ? '등록 중...' : '계좌 등록'}
              </button>
            </div>

            <div className="flex gap-4 text-xs">
              {totalIn  > 0 && <span className="text-blue-600">입금 {fmt(totalIn)}</span>}
              {totalOut > 0 && <span className="text-red-500">출금 {fmt(totalOut)}</span>}
            </div>

            {errors[alias] && (
              <p className="text-xs text-red-500">{errors[alias]}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
