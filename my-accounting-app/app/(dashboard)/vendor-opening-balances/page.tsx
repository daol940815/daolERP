'use client'

import { useCallback, useEffect, useState } from 'react'

const won = (n: number) => Math.abs(n).toLocaleString('ko-KR')

interface Row {
  vendor_id: string
  name: string
  type: string | null
  amount: number      // 양수=미수, 음수=미지급
  note: string | null
  has_value: boolean
}

export default function VendorOpeningBalancesPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // 편집중 입력: vendor_id -> { sign: '미수'|'미지급', value: string }
  const [edit, setEdit] = useState<Record<string, { sign: '미수' | '미지급'; value: string }>>({})

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async (q: string) => {
    setLoading(true)
    const res = await fetch(`/api/vendor-opening-balances?q=${encodeURIComponent(q)}`)
    const json = await res.json()
    if (Array.isArray(json.data)) setRows(json.data)
    else flash(`조회 실패: ${json.error ?? '오류'}`)
    setLoading(false)
  }, [])

  useEffect(() => { load('') }, [load])

  const startEdit = (r: Row) => setEdit(e => ({
    ...e,
    [r.vendor_id]: { sign: r.amount < 0 ? '미지급' : '미수', value: r.amount ? String(Math.abs(r.amount)) : '' },
  }))

  const save = async (vendorId: string) => {
    const ed = edit[vendorId]; if (!ed) return
    const mag = Number((ed.value || '').replace(/,/g, '').trim() || 0)
    if (!Number.isFinite(mag) || mag < 0) { flash('금액이 올바르지 않습니다.'); return }
    const amount = ed.sign === '미지급' ? -mag : mag
    setBusy(true)
    const res = await fetch('/api/vendor-opening-balances', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor_id: vendorId, amount }),
    })
    const json = await res.json()
    setBusy(false)
    if (res.ok) {
      flash(amount === 0 ? '삭제됨' : '저장됨')
      setEdit(e => { const n = { ...e }; delete n[vendorId]; return n })
      load(search)
    } else flash(`저장 실패: ${json.error ?? '오류'}`)
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">거래처별 기초잔액</h1>
      <p className="text-sm mt-1 text-gray-500">도입 이전 미수금/미지급금을 거래처별로 입력합니다. 거래처원장의 전월이월 시작점이 됩니다.</p>

      {msg && <div className="mb-3 mt-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      <div className="flex items-center gap-2 my-4">
        <input value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') load(search) }}
          placeholder="거래처명 검색 후 Enter (미입력 시 기초잔액 등록된 거래처만 표시)"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm flex-1" />
        <button onClick={() => load(search)} disabled={busy}
          className="px-3.5 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">검색</button>
        <button onClick={() => { const a = document.createElement('a'); a.href = '/api/vendor-opening-balances/export'; a.click() }}
          className="px-3.5 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 whitespace-nowrap">↓ 엑셀</button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          {search ? '검색 결과가 없습니다.' : '등록된 거래처 기초잔액이 없습니다. 거래처명을 검색해 입력하세요.'}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium">거래처</th>
                <th className="py-2 px-3 text-left font-medium w-28">구분</th>
                <th className="py-2 px-3 text-right font-medium w-40">금액</th>
                <th className="py-2 px-3 text-right font-medium w-20"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const ed = edit[r.vendor_id]
                return (
                  <tr key={r.vendor_id} className="border-b border-gray-50 last:border-0">
                    <td className="py-1.5 px-3 text-gray-800">{r.name}</td>
                    <td className="py-1.5 px-3">
                      {ed ? (
                        <select value={ed.sign} onChange={e => setEdit(s => ({ ...s, [r.vendor_id]: { ...ed, sign: e.target.value as '미수' | '미지급' } }))}
                          className="border border-gray-300 rounded px-2 py-1 text-xs">
                          <option value="미수">미수(채권)</option>
                          <option value="미지급">미지급(채무)</option>
                        </select>
                      ) : r.has_value ? (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${r.amount < 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                          {r.amount < 0 ? '미지급' : '미수'}
                        </span>
                      ) : <span className="text-gray-300 text-xs">미설정</span>}
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      {ed ? (
                        <input autoFocus value={ed.value}
                          onChange={e => setEdit(s => ({ ...s, [r.vendor_id]: { ...ed, value: e.target.value } }))}
                          onKeyDown={e => { if (e.key === 'Enter') save(r.vendor_id) }}
                          placeholder="0" className="w-32 text-right border border-slate-400 rounded px-2 py-1 text-sm" />
                      ) : (
                        <button onClick={() => startEdit(r)} className={`tabular-nums ${r.amount < 0 ? 'text-red-600' : r.amount > 0 ? 'text-blue-700' : 'text-gray-400'}`}>
                          {r.has_value ? won(r.amount) : '입력'}
                        </button>
                      )}
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      {ed && (
                        <button onClick={() => save(r.vendor_id)} disabled={busy}
                          className="text-xs px-2 py-1 bg-slate-800 text-white rounded hover:bg-slate-600 disabled:opacity-50">저장</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4">
        · <b>미수(채권)</b>는 받을 돈(매출처), <b>미지급(채무)</b>은 줄 돈(매입처)입니다. 금액은 양수로 입력하고 구분으로 부호를 정합니다.<br />
        · 0으로 저장하면 삭제됩니다. 거래처원장 잔액/내용 탭의 전월이월에 반영됩니다.
      </p>
    </div>
  )
}
