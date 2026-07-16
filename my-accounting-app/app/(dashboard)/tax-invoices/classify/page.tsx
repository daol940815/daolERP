'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

interface Account { id: string; code: string; name: string; type: string }
interface Group {
  key: string
  vendor_id: string | null
  counterparty_name: string
  count: number
  supply_total: number
  invoice_ids: string[]
  date_from: string
  date_to: string
  suggestion: { account_id: string; code: string; name: string; reason: string } | null
}
interface Summary { total: number; classified: number; unclassified: number; groups: number; suggested_groups: number }

// 매입 세금계산서 거래처별 일괄 분류 — "거래처가 곧 계정"인 매입 특성을 이용해
// 그룹 단위로 확정한다. 확정 즉시 분개 자동 생성(멱등), 기본계정 저장 시 다음부터 자동 추천.
export default function PurchaseClassifyPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // 그룹별 선택 계정(추천으로 초기화) / 기본계정 저장 체크
  const [pick, setPick] = useState<Record<string, string>>({})
  const [saveDefault, setSaveDefault] = useState<Record<string, boolean>>({})

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000) }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/tax-invoices/classify-groups?direction=purchase', { cache: 'no-store' })
    const json = await res.json()
    if (Array.isArray(json.data)) {
      setGroups(json.data)
      setSummary(json.summary)
      const initial: Record<string, string> = {}
      const initialDef: Record<string, boolean> = {}
      for (const g of json.data as Group[]) {
        if (g.suggestion) initial[g.key] = g.suggestion.account_id
        initialDef[g.key] = !!g.vendor_id   // 거래처가 연결된 그룹은 기본계정 저장을 기본 on
      }
      setPick(initial)
      setSaveDefault(initialDef)
    } else {
      showMsg(`조회 실패: ${json.error ?? '오류'}`)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    fetch('/api/accounts').then(r => r.json()).then(j => setAccounts(j.data ?? []))
  }, [load])

  const expenseFirst = useMemo(() => {
    const order = (t: string) => (t === 'expense' ? 0 : t === 'asset' ? 1 : 2)
    return [...accounts].sort((a, b) => order(a.type) - order(b.type) || a.code.localeCompare(b.code))
  }, [accounts])

  const filtered = useMemo(
    () => groups.filter(g => !search.trim() || g.counterparty_name.includes(search.trim())),
    [groups, search],
  )

  const confirmGroup = async (g: Group) => {
    const accountId = pick[g.key]
    if (!accountId) { showMsg('계정과목을 선택하세요.'); return }
    const accName = accounts.find(a => a.id === accountId)?.name ?? ''
    if (!window.confirm(`'${g.counterparty_name}' ${g.count}건(${won(g.supply_total)})을 [${accName}] 으로 확정하고 분개를 생성합니다.`)) return
    setBusyKey(g.key)
    const res = await fetch('/api/tax-invoices/bulk-classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoiceIds: g.invoice_ids,
        accountId,
        vendorId: g.vendor_id ?? undefined,
        saveAsDefault: !!(saveDefault[g.key] && g.vendor_id),
      }),
    })
    const json = await res.json()
    setBusyKey(null)
    if (!res.ok) { showMsg(`확정 실패: ${json.error ?? '오류'}`); return }
    showMsg(`${g.counterparty_name}: 확정 ${json.classified}건 · 분개 ${json.posted}건${json.skippedConfirmed ? ` · 기확정 건너뜀 ${json.skippedConfirmed}건` : ''}${json.failed ? ` · 실패 ${json.failed}건` : ''}${json.defaultSaved ? ' · 기본계정 저장됨' : ''}`)
    load()
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-900">매입 계산서 일괄 분류</h1>
        <p className="text-sm mt-1 text-gray-500">
          미분류 매입 세금계산서를 거래처 단위로 묶어 한 번에 확정합니다. 확정 즉시 분개가 생성되고,
          기본계정을 저장하면 다음 분류부터 자동 추천됩니다.
        </p>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {summary && (
        <div className="flex gap-4 my-3 text-sm">
          <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
            미분류 <b>{summary.unclassified.toLocaleString()}</b>건 / 전체 {summary.total.toLocaleString()}건
          </div>
          <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
            거래처 그룹 <b>{summary.groups.toLocaleString()}</b>개 (추천 있음 {summary.suggested_groups.toLocaleString()}개)
          </div>
        </div>
      )}

      <div className="my-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="거래처 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56"
        />
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm py-10 text-center">불러오는 중...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-400 text-sm py-10 text-center">미분류 계산서가 없습니다. 🎉</p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left">거래처</th>
                <th className="px-3 py-2 text-right">건수</th>
                <th className="px-3 py-2 text-right">공급가 합계</th>
                <th className="px-3 py-2 text-left">기간</th>
                <th className="px-3 py-2 text-left">추천</th>
                <th className="px-3 py-2 text-left">계정과목</th>
                <th className="px-3 py-2 text-center">기본계정</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(g => (
                <tr key={g.key} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">{g.counterparty_name}</td>
                  <td className="px-3 py-2 text-right">{g.count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{won(g.supply_total)}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{g.date_from.slice(2, 10)} ~ {g.date_to.slice(2, 10)}</td>
                  <td className="px-3 py-2 text-xs">
                    {g.suggestion
                      ? <span className="text-blue-700">{g.suggestion.name} <span className="text-gray-400">({g.suggestion.reason})</span></span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={pick[g.key] ?? ''}
                      onChange={e => setPick(p => ({ ...p, [g.key]: e.target.value }))}
                      className="border border-gray-300 rounded px-2 py-1 text-xs w-44"
                    >
                      <option value="">선택...</option>
                      {expenseFirst.map(a => (
                        <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      disabled={!g.vendor_id}
                      checked={!!(saveDefault[g.key] && g.vendor_id)}
                      onChange={e => setSaveDefault(s => ({ ...s, [g.key]: e.target.checked }))}
                      title={g.vendor_id ? '이 계정을 거래처 기본계정으로 저장' : '거래처 미연결 — 저장 불가'}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => confirmGroup(g)}
                      disabled={busyKey === g.key || !pick[g.key]}
                      className="px-3 py-1 bg-slate-900 text-white rounded text-xs font-medium hover:bg-slate-700 disabled:opacity-40"
                    >
                      {busyKey === g.key ? '처리 중...' : `${g.count}건 확정`}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
