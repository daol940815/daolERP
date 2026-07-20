'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

const won = (n: number | null | undefined) => (n ?? 0).toLocaleString('ko-KR')

const TYPE_LABEL: Record<string, string> = { asset: '자산', liability: '부채', equity: '자본' }
const TYPE_ORDER = ['asset', 'liability', 'equity']

interface Row {
  id: string
  code: string | null
  name: string
  type: string
  amount: number
  source: 'auto_bank' | 'manual' | null
  as_of_date: string | null
  note: string | null
  has_value: boolean
}

export default function OpeningBalancesPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [suggest, setSuggest] = useState<Record<string, number>>({})

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/opening-balances')
    const json = await res.json()
    if (Array.isArray(json.data)) setRows(json.data)
    else flash(`조회 실패: ${json.error ?? '오류'}`)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const loadSuggestions = async () => {
    setBusy(true)
    const res = await fetch('/api/opening-balances/suggest-bank')
    const json = await res.json()
    setBusy(false)
    if (res.ok && Array.isArray(json.suggestions)) {
      const m: Record<string, number> = {}
      for (const s of json.suggestions) m[s.account_id] = s.suggested
      setSuggest(m)
      flash(`은행 추정값 ${json.suggestions.length}건 불러옴 (검토 후 [적용]하세요)`)
    } else flash(`추정값 조회 실패: ${json.error ?? '오류'}`)
  }

  const saveValue = async (accountId: string, amount: number) => {
    if (!Number.isFinite(amount)) { flash('금액이 올바르지 않습니다.'); return }
    setBusy(true)
    const res = await fetch('/api/opening-balances', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: accountId, amount }),
    })
    const json = await res.json()
    setBusy(false)
    if (res.ok) {
      flash(amount === 0 ? '기초잔액 삭제됨' : '기초잔액 저장됨')
      setEdit(e => { const n = { ...e }; delete n[accountId]; return n })
      setSuggest(s => { const n = { ...s }; delete n[accountId]; return n })
      load()
    } else flash(`저장 실패: ${json.error ?? '오류'}`)
  }

  const saveManual = (accountId: string) =>
    saveValue(accountId, Number((edit[accountId] ?? '').replace(/,/g, '').trim() || 0))

  const totals = useMemo(() => {
    const t: Record<string, number> = { asset: 0, liability: 0, equity: 0 }
    for (const r of rows) t[r.type] = (t[r.type] ?? 0) + r.amount
    return t
  }, [rows])

  const grouped = useMemo(
    () => TYPE_ORDER.map(type => ({ type, items: rows.filter(r => r.type === type) })).filter(g => g.items.length),
    [rows],
  )

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">기초잔액 (전기이월)</h1>
      <p className="text-sm mt-1 text-gray-500">시스템 도입 이전부터 넘어온 잔액입니다. 자산·부채·자본만 대상이며, 원장의 전월이월 시작점이 됩니다.</p>

      {msg && <div className="mb-3 mt-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      <div className="flex items-center gap-2 my-4">
        <button onClick={loadSuggestions} disabled={busy}
          className="px-3.5 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-100 disabled:opacity-50">
          은행 추정값 불러오기
        </button>
        <button onClick={() => { const a = document.createElement('a'); a.href = '/api/opening-balances/export'; a.click() }}
          className="px-3.5 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
          ↓ 엑셀
        </button>
        <span className="text-xs text-amber-600">거래 순서 정보(시각)가 없어 추정값은 부정확할 수 있습니다. 도입시점 실제 잔액을 확인해 수기 확정하세요.</span>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : (
        <div className="space-y-5">
          {grouped.map(g => (
            <div key={g.type} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
                <span className="text-sm font-semibold text-gray-700">{TYPE_LABEL[g.type]}</span>
                <span className="text-sm text-gray-500">소계 <b className="text-gray-800">{won(totals[g.type])}</b>원</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs border-b border-gray-100">
                    <th className="py-1.5 px-3 text-left font-medium w-20">코드</th>
                    <th className="py-1.5 px-2 text-left font-medium">계정과목</th>
                    <th className="py-1.5 px-3 text-right font-medium w-44">기초잔액</th>
                    <th className="py-1.5 px-3 text-left font-medium w-24">구분</th>
                    <th className="py-1.5 px-3 text-right font-medium w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map(r => {
                    const editing = r.id in edit
                    return (
                      <tr key={r.id} className="border-b border-gray-50 last:border-0">
                        <td className="py-1.5 px-3 text-gray-400 font-mono text-xs">{r.code}</td>
                        <td className="py-1.5 px-2 text-gray-800">{r.name}</td>
                        <td className="py-1.5 px-3 text-right">
                          <input
                            value={editing ? edit[r.id] : (r.amount ? won(r.amount) : '')}
                            onChange={e => setEdit(s => ({ ...s, [r.id]: e.target.value }))}
                            onFocus={() => setEdit(s => ({ ...s, [r.id]: String(r.amount || '') }))}
                            placeholder="0"
                            className={`w-40 text-right border rounded px-2 py-1 text-sm ${editing ? 'border-slate-400 bg-white' : 'border-transparent hover:border-gray-200'}`}
                          />
                        </td>
                        <td className="py-1.5 px-3">
                          {r.source === 'auto_bank'
                            ? <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">자동</span>
                            : r.source === 'manual'
                            ? <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">수기</span>
                            : <span className="text-xs text-gray-300">-</span>}
                        </td>
                        <td className="py-1.5 px-3 text-right whitespace-nowrap">
                          {editing ? (
                            <button onClick={() => saveManual(r.id)} disabled={busy}
                              className="text-xs px-2 py-1 bg-slate-800 text-white rounded hover:bg-slate-600 disabled:opacity-50">
                              저장
                            </button>
                          ) : r.id in suggest ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-xs text-amber-600">추정 {won(suggest[r.id])}</span>
                              <button onClick={() => saveValue(r.id, suggest[r.id])} disabled={busy}
                                className="text-xs px-2 py-1 border border-amber-400 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50">
                                적용
                              </button>
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4">
        · 자산·비용은 차변(+), 부채·자본은 대변(+) 기준으로 입력합니다. (예: 단기차입금 기초 = 갚을 차입액을 양수로)<br />
        · 칸을 클릭해 숫자를 입력하고 저장하면 수기로 저장됩니다. 0으로 저장하면 삭제됩니다.<br />
        · &lsquo;은행 추정값 불러오기&rsquo;는 통장 거래후잔액에서 역산한 <b>참고용 추정치</b>일 뿐 자동 저장하지 않습니다. [적용]하면 수기값으로 확정됩니다.
      </p>
    </div>
  )
}
