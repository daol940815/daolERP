'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import SearchableSelect from '@/components/ui/SearchableSelect'

// 카드번호 → 매출처 연결 (매출 사이클 ③)
// 카드로 결제한 매출처를 확인하기 위해, 매출처 미연결 카드매출을 카드번호 단위로 묶고
// ERP 주문과의 금액·일자 대응을 추천으로 보여준다. 확정은 사용자.
// 확정하면 그 카드번호의 카드매출 전체에 매출처가 태깅되고, 거래처에 카드번호가
// 학습되어 이후 업로드부터는 자동 태깅된다.

interface Suggestion {
  alias_id: string
  alias_name: string
  vendor_id: string | null
  vendor_name: string | null
  hits: number
  total_hits: number
}
interface Group {
  card_number: string
  count: number
  net_amount: number
  first_date: string
  last_date: string
  acquirers: string[]
  suggestion: Suggestion | null
}
interface VendorOpt { id: string; name: string; type: string }

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`

export default function CardCustomerLinksPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [summary, setSummary] = useState<{ card_numbers: number; with_suggestion: number; linkable_now: number; total_net: number } | null>(null)
  const [vendors, setVendors] = useState<VendorOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pick, setPick] = useState<Record<string, string>>({})     // card_number → vendor_id (수동 선택)
  const [busy, setBusy] = useState<string | null>(null)
  const [onlySuggested, setOnlySuggested] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000) }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/card-sales/customer-groups', { cache: 'no-store' })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? '조회 실패'); setLoading(false); return }
    setGroups(json.groups ?? [])
    setSummary(json.summary ?? null)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    fetch('/api/vendors?all=true')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.data)) {
          setVendors((d.data as VendorOpt[]).filter(v => v.type === 'customer' || v.type === 'both'))
        }
      })
      .catch(() => null)
  }, [load])

  const assign = async (g: Group, vendorId: string, vendorLabel: string) => {
    if (!window.confirm(`카드 ${g.card_number} (${g.count}건 · ${won(g.net_amount)})를 "${vendorLabel}" 매출처로 연결합니다.\n이후 업로드부터 이 카드는 자동으로 태깅됩니다.`)) return
    setBusy(g.card_number)
    const res = await fetch('/api/card-sales/assign-customer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardNumber: g.card_number, vendorId }),
    })
    const json = await res.json()
    setBusy(null)
    if (!res.ok) { showMsg(json.error ?? '연결 실패'); return }
    showMsg(`${json.vendor_name}: ${json.tagged}건 태깅 완료 (카드번호 학습됨)`)
    load()
  }

  const visible = onlySuggested ? groups.filter(g => g.suggestion) : groups

  return (
    <div className="max-w-6xl mx-auto">
      <Link href="/card-sales" className="text-sm text-gray-500 hover:text-gray-900">← 카드매출</Link>
      <h1 className="text-2xl font-bold text-gray-900 mt-2">카드번호 → 매출처 연결</h1>
      <p className="text-sm mt-1 text-gray-500 mb-4">
        카드로 결제한 매출처를 확인하기 위한 화면입니다. ERP 주문과 금액·일자가 대응하는 매출처를
        추천으로 보여주며, 확정하면 해당 카드번호 전체가 태깅되고 이후 업로드부터 자동 적용됩니다.
      </p>

      {msg && <div className="mb-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="mb-3 px-4 py-2.5 bg-red-600 text-white text-sm rounded-lg">{error}</div>}

      {summary && (
        <div className="flex gap-3 flex-wrap mb-4">
          <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[150px]">
            <p className="text-xs text-gray-400 mb-1">미연결 카드번호</p>
            <p className="text-lg font-bold text-gray-900">{summary.card_numbers.toLocaleString()}개</p>
            <p className="text-xs text-gray-400">순승인액 {won(summary.total_net)}</p>
          </div>
          <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[150px]">
            <p className="text-xs text-gray-400 mb-1">ERP 주문 대응 추천</p>
            <p className="text-lg font-bold text-blue-700">{summary.with_suggestion.toLocaleString()}개</p>
            <p className="text-xs text-gray-400">그중 거래처 연결까지 준비된 것 {summary.linkable_now.toLocaleString()}개</p>
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-gray-600 mb-3">
        <input type="checkbox" checked={onlySuggested} onChange={e => setOnlySuggested(e.target.checked)} />
        추천 있는 카드만 보기
      </label>

      {loading ? (
        <p className="text-gray-400 text-sm py-10 text-center">카드번호 그룹·추천 계산 중...</p>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 border border-green-200 bg-green-50 rounded-xl">
          <p className="text-green-700 font-medium">연결할 카드번호가 없습니다</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left">카드번호</th>
                <th className="px-3 py-2 text-right">건수</th>
                <th className="px-3 py-2 text-right">순승인액</th>
                <th className="px-3 py-2 text-left">기간</th>
                <th className="px-3 py-2 text-left">추천 매출처 (ERP 주문 대응)</th>
                <th className="px-3 py-2 text-left w-64">연결할 거래처</th>
                <th className="px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map(g => {
                const s = g.suggestion
                const picked = pick[g.card_number] ?? s?.vendor_id ?? ''
                const pickedName = vendors.find(v => v.id === picked)?.name ?? s?.vendor_name ?? ''
                return (
                  <tr key={g.card_number} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-gray-900 whitespace-nowrap">{g.card_number}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{g.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{won(g.net_amount)}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{g.first_date.slice(2, 10)} ~ {g.last_date.slice(2, 10)}</td>
                    <td className="px-3 py-2 text-xs">
                      {s ? (
                        <span>
                          <span className="text-gray-900 font-medium">{s.alias_name}</span>
                          <span className="text-gray-400"> · 대응 {s.hits}건{s.total_hits > s.hits ? ` / 전체 ${s.total_hits}` : ''}</span>
                          {!s.vendor_id && <span className="block text-amber-600 mt-0.5">이 별칭은 아직 거래처 미연결 — 별칭 관리에서 먼저 연결하거나 아래에서 직접 선택</span>}
                        </span>
                      ) : (
                        <span className="text-gray-300">대응 없음</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <SearchableSelect
                        value={picked}
                        onChange={id => setPick(prev => ({ ...prev, [g.card_number]: id }))}
                        options={vendors.map(v => ({ id: v.id, label: v.name }))}
                        emptyLabel="(거래처 선택)"
                        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-left bg-white"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => picked && assign(g, picked, pickedName)}
                        disabled={!picked || busy === g.card_number}
                        className="px-2.5 py-1.5 bg-slate-900 text-white rounded text-xs font-medium hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap">
                        {busy === g.card_number ? '연결 중...' : '연결'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3">
        추천 기준: 카드 승인액이 ERP 주문 합계(또는 실결제액)와 일치하고 승인일이 주문일 ±7일 이내이며,
        그 대응이 한 매출처로만 좁혀지는 경우. 대응 건수가 많을수록 신뢰가 높습니다.
        연결 해제는 거래처 상세의 카드번호 목록에서 할 수 있습니다.
      </p>
    </div>
  )
}
