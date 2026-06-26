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

  const deriveBank = async () => {
    if (!confirm('은행 거래후잔액을 역산해 보통예금·단기차입금 기초잔액을 자동 계산합니다.\n기존 자동값은 덮어씁니다. 진행할까요?')) return
    setBusy(true)
    const res = await fetch('/api/opening-balances/derive-bank', { method: 'POST' })
    const json = await res.json()
    setBusy(false)
    if (res.ok) { flash(`은행 기초잔액 ${json.derived?.length ?? 0}개 계정 자동 계산 완료`); load() }
    else flash(`자동 계산 실패: ${json.error ?? '오류'}`)
  }

  const saveManual = async (accountId: string) => {
    const raw = (edit[accountId] ?? '').replace(/,/g, '').trim()
    const amount = Number(raw || 0)
    if (!Number.isFinite(amount)) { flash('금액이 올바르지 않습니다.'); return }
    setBusy(true)
    const res = await fetch('/api/opening-balances', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: accountId, amount }),
    })
    const json = await res.json()
    setBusy(false)
    if (res.ok) { flash(amount === 0 ? '기초잔액 삭제됨' : '기초잔액 저장됨'); setEdit(e => { const n = { ...e }; delete n[accountId]; return n }); load() }
    else flash(`저장 실패: ${json.error ?? '오류'}`)
  }

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
        <button onClick={deriveBank} disabled={busy}
          className="px-3.5 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
          🏦 은행 기초잔액 자동계산
        </button>
        <span className="text-xs text-gray-400">보통예금·단기차입금은 통장 거래후잔액에서 자동 도출됩니다.</span>
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
                        <td className="py-1.5 px-3 text-right">
                          {editing && (
                            <button onClick={() => saveManual(r.id)} disabled={busy}
                              className="text-xs px-2 py-1 bg-slate-800 text-white rounded hover:bg-slate-600 disabled:opacity-50">
                              저장
                            </button>
                          )}
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
        · 은행 자동계산은 보통예금·단기차입금을 통장 거래후잔액에서 역산하며, 수기로 덮어쓸 수 있습니다.
      </p>
    </div>
  )
}
