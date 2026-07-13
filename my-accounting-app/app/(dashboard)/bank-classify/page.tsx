'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

interface Account { id: string; code: string; name: string; type: string }
interface Suggestion { account_id: string; code: string; name: string; reason: string; vendor_id?: string | null }
interface Group {
  key: string
  kind: 'internal' | 'settlement' | 'card_payment' | 'invoice' | 'general'
  label: string
  count: number
  in_total: number
  out_total: number
  transaction_ids: string[]
  suggestion: Suggestion | null
  pairable?: number
}
interface Types { transfer: number; classified: number; internal: number; settlement: number; card_payment: number; invoice: number; general: number }

const KIND_BADGE: Record<Group['kind'], { label: string; cls: string }> = {
  internal:     { label: '이체 후보', cls: 'bg-amber-100 text-amber-700' },
  settlement:   { label: '카드 정산', cls: 'bg-blue-100 text-blue-700' },
  card_payment: { label: '카드대금', cls: 'bg-purple-100 text-purple-700' },
  invoice:      { label: '세계 매칭', cls: 'bg-teal-100 text-teal-700' },
  general:      { label: '일반', cls: 'bg-gray-100 text-gray-600' },
}

// 통장 거래 분류 — 유형(이체·정산·카드대금·세계매칭)을 갈라낸 뒤 나머지를 유사거래
// 묶음으로 일괄 확정한다. 확정 즉시 은행 분개 생성(멱등). 추천은 추천일 뿐, 확정은 사용자.
export default function BankClassifyPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [types, setTypes] = useState<Types | null>(null)
  const [total, setTotal] = useState(0)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [pairing, setPairing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [pick, setPick] = useState<Record<string, string>>({})

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000) }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/transactions/classify-groups', { cache: 'no-store' })
    const json = await res.json()
    if (Array.isArray(json.data)) {
      setGroups(json.data)
      setTypes(json.types)
      setTotal(json.total ?? 0)
      const initial: Record<string, string> = {}
      for (const g of json.data as Group[]) if (g.suggestion) initial[g.key] = g.suggestion.account_id
      setPick(initial)
    } else {
      showMsg(`조회 실패: ${json.error ?? '오류'}`)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    fetch('/api/accounts').then(r => r.json()).then(j => setAccounts(j.data ?? []))
  }, [load])

  const sortedAccounts = useMemo(() => {
    const order = (t: string) => (t === 'expense' ? 0 : t === 'income' ? 1 : t === 'asset' ? 2 : 3)
    return [...accounts].sort((a, b) => order(a.type) - order(b.type) || a.code.localeCompare(b.code))
  }, [accounts])

  const filtered = useMemo(
    () => groups.filter(g => !search.trim() || g.label.includes(search.trim())),
    [groups, search],
  )

  const runPairTransfers = async () => {
    if (!window.confirm('자사명(다올) 입출금에서 금액·날짜가 맞는 이체쌍을 찾아 연결합니다. 연결된 쌍은 분개 대상에서 제외됩니다.')) return
    setPairing(true)
    const res = await fetch('/api/transactions/match-transfers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    })
    const json = await res.json()
    setPairing(false)
    if (!res.ok) { showMsg(`이체 연결 실패: ${json.error ?? '오류'}`); return }
    showMsg(`✓ 이체쌍 연결 완료: ${JSON.stringify(json.matched ?? json)}`.slice(0, 120))
    load()
  }

  const confirmGroup = async (g: Group) => {
    const accountId = pick[g.key]
    if (!accountId) { showMsg('계정과목을 선택하세요.'); return }
    const accName = accounts.find(a => a.id === accountId)?.name ?? ''
    if (!window.confirm(`'${g.label}' ${g.count}건 (입금 ${won(g.in_total)} / 출금 ${won(g.out_total)})을 [${accName}] 으로 확정하고 분개를 생성합니다.`)) return
    setBusyKey(g.key)
    const res = await fetch('/api/transactions/bulk-classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactionIds: g.transaction_ids,
        accountId,
        vendorId: g.suggestion?.vendor_id ?? undefined,
      }),
    })
    const json = await res.json()
    setBusyKey(null)
    if (!res.ok) { showMsg(`확정 실패: ${json.error ?? '오류'}`); return }
    showMsg(`✓ ${g.label}: 확정 ${json.confirmed}건 · 분개 ${json.posted}건${json.failed ? ` · 실패 ${json.failed}` : ''}${json.skippedTransfer ? ` · 이체 제외 ${json.skippedTransfer}` : ''}`)
    load()
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">통장 거래 분류</h1>
          <p className="text-sm mt-1 text-gray-500">
            이체·정산·카드대금·세계매칭을 갈라낸 뒤, 나머지를 유사거래 묶음으로 일괄 확정합니다.
          </p>
        </div>
        <button
          onClick={runPairTransfers}
          disabled={pairing}
          className="px-3 py-1.5 border border-amber-400 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-50 disabled:opacity-50"
        >
          {pairing ? '연결 중...' : '⇄ 자사명 이체쌍 자동 연결'}
        </button>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {types && (
        <div className="flex flex-wrap gap-2 my-3 text-xs">
          <span className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg">전체 {total.toLocaleString()}건</span>
          <span className="px-2.5 py-1.5 bg-green-50 border border-green-200 rounded-lg text-green-700">분류완료 {types.classified.toLocaleString()}</span>
          <span className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg">이체 연결됨 {types.transfer.toLocaleString()}</span>
          <span className="px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-700">이체 후보 {types.internal.toLocaleString()}</span>
          <span className="px-2.5 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-blue-700">카드 정산 {types.settlement.toLocaleString()}</span>
          <span className="px-2.5 py-1.5 bg-purple-50 border border-purple-200 rounded-lg text-purple-700">카드대금 {types.card_payment.toLocaleString()}</span>
          <span className="px-2.5 py-1.5 bg-teal-50 border border-teal-200 rounded-lg text-teal-700">세계 매칭 {types.invoice.toLocaleString()}</span>
          <span className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg">일반 {types.general.toLocaleString()}</span>
        </div>
      )}

      <div className="my-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="묶음 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56"
        />
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm py-10 text-center">불러오는 중...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-400 text-sm py-10 text-center">분류할 거래가 없습니다. 🎉</p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left">유형</th>
                <th className="px-3 py-2 text-left">묶음</th>
                <th className="px-3 py-2 text-right">건수</th>
                <th className="px-3 py-2 text-right">입금 합계</th>
                <th className="px-3 py-2 text-right">출금 합계</th>
                <th className="px-3 py-2 text-left">추천</th>
                <th className="px-3 py-2 text-left">계정과목</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(g => (
                <tr key={g.key} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${KIND_BADGE[g.kind].cls}`}>
                      {KIND_BADGE[g.kind].label}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {g.label}
                    {g.kind === 'internal' && (
                      <span className="block text-[11px] font-normal text-amber-600">
                        이체쌍 후보 {g.pairable ?? 0}건 — 위의 &lsquo;이체쌍 자동 연결&rsquo;로 처리, 나머지는 상대계좌 미업로드분(급여통장 등)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{g.count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{g.in_total ? won(g.in_total) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{g.out_total ? won(g.out_total) : '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {g.suggestion
                      ? <span className="text-blue-700">{g.suggestion.name} <span className="text-gray-400">({g.suggestion.reason})</span></span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {g.kind === 'internal' ? (
                      <span className="text-xs text-gray-400">확정 대상 아님</span>
                    ) : (
                      <select
                        value={pick[g.key] ?? ''}
                        onChange={e => setPick(p => ({ ...p, [g.key]: e.target.value }))}
                        className="border border-gray-300 rounded px-2 py-1 text-xs w-44"
                      >
                        <option value="">선택...</option>
                        {sortedAccounts.map(a => (
                          <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {g.kind !== 'internal' && (
                      <button
                        onClick={() => confirmGroup(g)}
                        disabled={busyKey === g.key || !pick[g.key]}
                        className="px-3 py-1 bg-slate-900 text-white rounded text-xs font-medium hover:bg-slate-700 disabled:opacity-40"
                      >
                        {busyKey === g.key ? '처리 중...' : `${g.count}건 확정`}
                      </button>
                    )}
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
