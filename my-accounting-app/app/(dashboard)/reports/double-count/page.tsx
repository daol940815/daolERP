'use client'

import { useCallback, useEffect, useState } from 'react'

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

interface Finding { check: 'A' | 'B' | 'C'; date: string; label: string; amount: number; detail: string }
interface Summary { A: number; B: number; C: number; total_amount: number }

const CHECK_LABEL: Record<Finding['check'], string> = {
  A: '세계 매칭 + 비용 확정',
  B: '통장 비용 ↔ 매입 세계',
  C: '법인카드 ↔ 매입 세계',
}

// 이중계상 상설 검사 — 같은 지출이 두 경로로 비용에 잡힌 건을 찾는다.
// "0건 유지"가 손익 신뢰의 방어선. 분류 작업을 진행한 뒤 수시로 실행.
export default function DoubleCountPage() {
  const [findings, setFindings] = useState<Finding[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/reports/double-count', { cache: 'no-store' })
    const json = await res.json()
    if (!res.ok) setError(json.error ?? '검사 실패')
    else { setFindings(json.findings ?? []); setSummary(json.summary ?? null) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">이중계상 검사</h1>
          <p className="text-sm mt-1 text-gray-500">
            같은 지출이 세금계산서·통장·법인카드 중 두 경로로 비용에 잡힌 건을 교차 검사합니다. 0건 유지가 목표입니다.
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
          {loading ? '검사 중...' : '↻ 다시 검사'}
        </button>
      </div>

      {error && <div className="mb-3 mt-2 px-4 py-2.5 bg-red-600 text-white text-sm rounded-lg">{error}</div>}

      {summary && (
        <div className="flex flex-wrap gap-2 my-4 text-sm">
          {(['A', 'B', 'C'] as const).map(k => (
            <span key={k} className={`px-3 py-2 rounded-lg border ${summary[k] === 0 ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {CHECK_LABEL[k]}: <b>{summary[k]}건</b>
            </span>
          ))}
          {summary.total_amount > 0 && (
            <span className="px-3 py-2 rounded-lg border bg-red-50 border-red-200 text-red-700">
              의심 금액 합계 <b>{won(summary.total_amount)}</b>
            </span>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm py-10 text-center">검사 중...</p>
      ) : findings.length === 0 ? (
        <div className="text-center py-16 border border-green-200 bg-green-50 rounded-xl">
          <p className="text-green-700 font-medium">이중계상 의심 건이 없습니다 ✓</p>
          <p className="text-xs text-green-600 mt-1">분류 작업 후에도 수시로 재검사해 0건을 유지하세요.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left">검사</th>
                <th className="px-3 py-2 text-left">일자</th>
                <th className="px-3 py-2 text-left">거래처/가맹점</th>
                <th className="px-3 py-2 text-right">금액</th>
                <th className="px-3 py-2 text-left">내용 / 권장 조치</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {findings.map((f, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">{CHECK_LABEL[f.check]}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{f.date}</td>
                  <td className="px-3 py-2">{f.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{won(f.amount)}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{f.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
