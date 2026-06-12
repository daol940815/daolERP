'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ErpVendorAlias } from '@/types/erp'
import { bestNameMatch } from '@/lib/name-similarity'

interface Vendor { id: string; name: string }
interface AliasRow extends ErpVendorAlias { vendors: { name: string } | null }

type Tab = 'customer' | 'purchase'

const pct = (n: number) => `${Math.round(n * 100)}%`

export default function ErpAliasesPage() {
  const [tab, setTab]           = useState<Tab>('customer')
  const [onlyUnmatched, setOnlyUnmatched] = useState(true)
  const [aliases, setAliases]   = useState<AliasRow[]>([])
  const [vendors, setVendors]   = useState<Vendor[]>([])
  const [loading, setLoading]   = useState(true)
  const [working, setWorking]   = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch]     = useState('')
  const [msg, setMsg]           = useState<string | null>(null)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ type: tab })
    const res  = await fetch(`/api/erp-aliases?${p}`)
    const json = await res.json()
    if (res.ok) setAliases(json.data ?? [])
    else showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`)
    setSelected(new Set())
    setLoading(false)
  }, [tab])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/vendors?all=true')
      .then(r => r.json())
      .then(d => { if (d.data) setVendors(d.data) })
      .catch(() => null)
  }, [])

  // 별칭별 추천 매칭 (미연결 건만 계산)
  const suggestions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; score: number }>()
    for (const a of aliases) {
      if (a.vendor_id) continue
      const m = bestNameMatch(a.erp_name, vendors)
      if (m) map.set(a.id, m)
    }
    return map
  }, [aliases, vendors])

  const patchAlias = async (id: string, vendorId: string | null): Promise<string | null> => {
    const res  = await fetch('/api/erp-aliases', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, vendor_id: vendorId }),
    })
    const json = await res.json()
    if (!res.ok) return json.error ?? '알 수 없는 오류'
    setAliases(prev => prev.map(a => a.id === id
      ? { ...a, vendor_id: vendorId, vendors: vendorId ? { name: vendors.find(v => v.id === vendorId)?.name ?? '' } : null }
      : a))
    return null
  }

  const handleConnect = async (alias: AliasRow, vendorId: string) => {
    setWorking(true)
    const err = await patchAlias(alias.id, vendorId || null)
    setWorking(false)
    if (err) { showMsg(`연결 실패: ${err}`); return }
    showMsg(vendorId ? '연결 완료 (이후 업로드에도 자동 적용)' : '연결 해제')
  }

  const handleCreateVendor = async (alias: AliasRow) => {
    if (!window.confirm(`"${alias.erp_name}" 이름으로 새 거래처를 만들고 바로 연결할까요?`)) return
    setWorking(true)
    const res  = await fetch('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: alias.erp_name, type: tab === 'customer' ? 'customer' : 'vendor' }),
    })
    const json = await res.json()
    if (!res.ok) { setWorking(false); showMsg(`거래처 생성 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    const v = json.data as Vendor
    setVendors(prev => [...prev, v].sort((a, b) => a.name.localeCompare(b.name, 'ko')))
    const err = await patchAlias(alias.id, v.id)
    setWorking(false)
    if (err) { showMsg(`연결 실패: ${err}`); return }
    showMsg(`거래처 "${v.name}" 생성 후 연결 완료`)
  }

  const handleBulkConnect = async () => {
    const targets = Array.from(selected)
      .map(id => ({ id, sug: suggestions.get(id) }))
      .filter((t): t is { id: string; sug: { id: string; name: string; score: number } } => !!t.sug)
    if (!targets.length) { showMsg('추천 매칭이 있는 항목을 선택하세요.'); return }
    if (!window.confirm(`선택한 ${targets.length}건을 추천 거래처로 일괄 연결할까요?`)) return
    setWorking(true)
    let ok = 0, fail = 0
    for (const t of targets) {
      const err = await patchAlias(t.id, t.sug.id)
      if (err) fail += 1
      else ok += 1
    }
    setWorking(false)
    setSelected(new Set())
    showMsg(`${ok}건 연결 완료${fail ? ` / ${fail}건 실패` : ''}`)
  }

  const selectHighConfidence = () => {
    const n = new Set<string>()
    for (const a of aliases) {
      if (a.vendor_id) continue
      const s = suggestions.get(a.id)
      if (s && s.score >= 0.9) n.add(a.id)
    }
    setSelected(n)
    if (!n.size) showMsg('유사도 90% 이상 추천이 없습니다.')
  }

  const toggleSelect = (id: string) => setSelected(prev => {
    const n = new Set(prev)
    if (n.has(id)) { n.delete(id) } else { n.add(id) }
    return n
  })

  const q = search.trim()
  const filtered = aliases
    .filter(a => !onlyUnmatched || !a.vendor_id)
    .filter(a => !q || a.erp_name.includes(q) || (a.vendors?.name ?? '').includes(q))

  const unmatchedCount = aliases.filter(a => !a.vendor_id).length

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-900">ERP 별칭 매칭</h1>
        <p className="text-sm mt-1 text-gray-500">
          ERP 매출처/매입처 이름을 거래처에 연결합니다. 한 번 연결하면 이후 업로드에도 자동 적용되며,
          여러 별칭(부서·지점)을 같은 거래처에 연결할 수 있습니다.
        </p>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {/* 탭 */}
      <div className="flex items-center gap-1 mb-3 mt-3 border-b border-gray-200">
        {([['customer', '매출처'], ['purchase', '매입처']] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-slate-900 text-slate-900 font-medium' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 필터 + 일괄 작업 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={onlyUnmatched} onChange={e => setOnlyUnmatched(e.target.checked)} />
          미연결만 보기
        </label>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="별칭/거래처명 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <span className="text-xs text-gray-400">미연결 {unmatchedCount} / 전체 {aliases.length}</span>
        <div className="flex-1" />
        <button
          onClick={selectHighConfidence}
          disabled={loading || working}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          유사도 90%↑ 전체선택
        </button>
        <button
          onClick={handleBulkConnect}
          disabled={loading || working || selected.size === 0}
          className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs hover:bg-slate-700 disabled:opacity-40"
        >
          {working ? '처리 중...' : `선택 ${selected.size}건 일괄 연결`}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          {onlyUnmatched ? '미연결 별칭이 없습니다. 모든 매칭이 완료되었습니다. 🎉' : '표시할 별칭이 없습니다.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 w-8"></th>
                <th className="py-2.5 px-3 font-medium">ERP 별칭명</th>
                <th className="py-2.5 px-3 font-medium">추천 거래처</th>
                <th className="py-2.5 px-3 font-medium text-right">유사도</th>
                <th className="py-2.5 px-3 font-medium">직접 선택 / 연결됨</th>
                <th className="py-2.5 px-3 font-medium text-right">액션</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => {
                const sug = suggestions.get(a.id)
                return (
                  <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3">
                      {!a.vendor_id && (
                        <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} disabled={!sug} />
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <p className="truncate max-w-[220px] text-gray-900">{a.erp_name}</p>
                    </td>
                    <td className="py-2 px-3">
                      {a.vendor_id ? (
                        <span className="text-xs text-gray-300">-</span>
                      ) : sug ? (
                        <p className="truncate max-w-[180px] text-blue-700">{sug.name}</p>
                      ) : (
                        <span className="text-xs text-gray-400">추천 없음</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {!a.vendor_id && sug ? (
                        <span className={`text-xs font-medium ${sug.score >= 0.9 ? 'text-green-600' : sug.score >= 0.7 ? 'text-amber-600' : 'text-gray-400'}`}>
                          {pct(sug.score)}
                        </span>
                      ) : <span className="text-xs text-gray-300">-</span>}
                    </td>
                    <td className="py-2 px-3">
                      <select
                        value={a.vendor_id ?? ''}
                        onChange={e => handleConnect(a, e.target.value)}
                        disabled={working}
                        className={`border rounded px-2 py-1 text-xs w-48 ${a.vendor_id ? 'border-green-200 text-green-700 bg-green-50' : 'border-gray-200 text-gray-500'}`}
                      >
                        <option value="">미연결</option>
                        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {!a.vendor_id && sug && (
                        <button
                          onClick={() => handleConnect(a, sug.id)}
                          disabled={working}
                          className="px-2 py-1 text-xs border border-blue-300 text-blue-700 rounded hover:bg-blue-50 disabled:opacity-40 mr-1"
                        >
                          ✓ 추천 연결
                        </button>
                      )}
                      {!a.vendor_id && (
                        <button
                          onClick={() => handleCreateVendor(a)}
                          disabled={working}
                          className="px-2 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50 disabled:opacity-40"
                        >
                          + 신규 생성
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
