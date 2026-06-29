'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getPeriodRange, PERIOD_PRESETS } from '@/lib/period-presets'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

interface Account { id: string; code: string; name: string; type: string }
interface CardAccount { id: string; card_company: string; card_number: string; alias: string | null; label: string }
interface Expense {
  id: string
  tx_date: string
  tx_time: string | null
  card_type: string | null
  merchant_name: string | null
  merchant_category: string | null
  approved_amount: number
  cancel_amount: number
  classification: string | null
  classify_status: 'pending' | 'confirmed'
  ai_reason: string | null
  card_account: { card_company: string; card_number: string; alias: string | null } | null
  confirmed: { code: string; name: string } | null
  suggested: { code: string; name: string } | null
}

export default function CardExpensesPage() {
  const [cardAccounts, setCardAccounts] = useState<CardAccount[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [rows, setRows] = useState<Expense[]>([])
  const [summary, setSummary] = useState({ count: 0, approved_total: 0, pending_count: 0 })
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [cardAccountId, setCardAccountId] = useState('')
  const [dateFrom, setDateFrom] = useState(() => getPeriodRange('당월').from)
  const [dateTo, setDateTo] = useState(() => getPeriodRange('당월').to)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  useEffect(() => {
    fetch('/api/card-accounts').then(r => r.json()).then(j => setCardAccounts(j.data ?? []))
    fetch('/api/accounts').then(r => r.json()).then(j => setAccounts(j.data ?? []))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (cardAccountId) p.set('cardAccountId', cardAccountId)
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo) p.set('to', dateTo)
    if (status) p.set('status', status)
    if (search.trim()) p.set('q', search.trim())
    const res = await fetch(`/api/card-expenses?${p}`)
    const json = await res.json()
    if (Array.isArray(json.data)) { setRows(json.data); setSummary(json.summary) }
    else { showMsg(`조회 실패: ${json.error ?? '오류'}`); setRows([]) }
    setLoading(false)
  }, [cardAccountId, dateFrom, dateTo, status, search])

  useEffect(() => { load() }, [load])

  const handleUpload = async (file: File) => {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/card-expenses/import', { method: 'POST', body: fd })
    const json = await res.json()
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
    if (!res.ok) { showMsg(`업로드 실패: ${json.error ?? '오류'}`); return }
    showMsg(`가져오기 완료: ${json.imported}건 (카드 ${json.card_accounts}개 · 확정 ${json.confirmed} · 제안 ${json.suggested} · 건너뜀 ${json.skipped})`)
    fetch('/api/card-accounts').then(r => r.json()).then(j => setCardAccounts(j.data ?? []))
    load()
  }

  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/card-expenses/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) { showMsg(json.error ?? '수정 실패'); return }
    load()
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">법인카드 사용내역</h1>
          <p className="text-sm mt-1 text-gray-500">카드사·카드번호별 사용내역. 파일의 계정과목은 확정, 비어 있으면 자동 제안 후 승인하세요.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => {
            const p = new URLSearchParams()
            if (cardAccountId) p.set('cardAccountId', cardAccountId)
            if (dateFrom) p.set('from', dateFrom); if (dateTo) p.set('to', dateTo)
            if (status) p.set('status', status)
            const a = document.createElement('a'); a.href = `/api/card-expenses/export?${p}`; a.click()
          }}
            className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
            ↓ 엑셀
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
            {uploading ? '업로드 중...' : '+ 파일 업로드'}
          </button>
        </div>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {/* 기간 빠른 선택 */}
      <div className="flex flex-wrap items-center gap-1 mb-2 mt-3">
        {PERIOD_PRESETS.map(p => (
          <button
            key={p}
            onClick={() => { const r = getPeriodRange(p); setDateFrom(r.from); setDateTo(r.to) }}
            className="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-slate-100 hover:border-slate-400 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-2 my-3 flex-wrap">
        <select value={cardAccountId} onChange={e => setCardAccountId(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
          <option value="">전체 카드</option>
          {cardAccounts.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
          <option value="">전체 상태</option>
          <option value="pending">미확정</option>
          <option value="confirmed">확정</option>
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="가맹점 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-44" />
      </div>

      {/* 요약 */}
      <div className="flex gap-3 flex-wrap mb-4">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">사용액 합계(승인금액)</p>
          <p className="text-lg font-bold text-gray-900">{won(summary.approved_total)}</p>
          <p className="text-xs text-gray-400">{summary.count.toLocaleString()}건</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">미확정(승인 필요)</p>
          <p className="text-lg font-bold text-amber-600">{summary.pending_count.toLocaleString()}건</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">표시할 데이터가 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium">이용일시</th>
                <th className="py-2.5 px-3 font-medium">카드</th>
                <th className="py-2.5 px-3 font-medium">가맹점</th>
                <th className="py-2.5 px-3 font-medium text-right">승인금액</th>
                <th className="py-2.5 px-3 font-medium">계정과목</th>
                <th className="py-2.5 px-3 font-medium">분류</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 whitespace-nowrap text-gray-500">
                    {r.tx_date}<span className="text-gray-300"> {r.tx_time ?? ''}</span>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap text-gray-500">
                    {r.card_account ? `${r.card_account.card_company} ${r.card_account.card_number.slice(-4)}` : '-'}
                  </td>
                  <td className="py-2 px-3">
                    <p className="text-gray-900 truncate max-w-[200px]">{r.merchant_name ?? '-'}</p>
                    <p className="text-xs text-gray-400">{r.merchant_category ?? ''}</p>
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap font-medium">{won(r.approved_amount)}</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <select
                      value={r.confirmed?.code ? accounts.find(a => a.code === r.confirmed!.code)?.id ?? '' : ''}
                      onChange={e => patch(r.id, { confirmed_account_id: e.target.value || null })}
                      className={`border rounded px-2 py-1 text-xs ${r.classify_status === 'confirmed' ? 'border-gray-300 text-gray-900' : 'border-amber-300 bg-amber-50 text-amber-700'}`}
                    >
                      <option value="">{r.suggested ? `(제안) ${r.suggested.name}` : '미지정'}</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    {r.classify_status === 'pending' && r.suggested && (
                      <button onClick={() => patch(r.id, { approve: true })}
                        className="ml-1 text-xs px-1.5 py-1 bg-amber-500 text-white rounded hover:bg-amber-600">승인</button>
                    )}
                  </td>
                  <td className="py-2 px-3 text-gray-500 text-xs">{r.classification ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
