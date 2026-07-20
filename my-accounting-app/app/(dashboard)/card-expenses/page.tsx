'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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

// 일괄 승인은 개별 PATCH를 나눠 호출한다 — 서버 60초 제한과 무관하게 완주 가능
const BULK_CONCURRENCY = 4

function CardExpensesContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [cardAccounts, setCardAccounts] = useState<CardAccount[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [rows, setRows] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [cardAccountId, setCardAccountId] = useState(() => searchParams.get('cardAccountId') ?? '')
  const [dateFrom, setDateFrom] = useState(() => getPeriodRange('당월').from)
  const [dateTo, setDateTo] = useState(() => getPeriodRange('당월').to)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState('') // '' 전체 | 'none' 미추천 | 계정 code
  const [editClass, setEditClass] = useState<{ id: string; value: string } | null>(null)

  // 체크박스 일괄 승인
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [bulkAccountId, setBulkAccountId] = useState('')
  const [bulkProgress, setBulkProgress] = useState<string | null>(null)
  const headerCheckRef = useRef<HTMLInputElement>(null)

  const showMsg = (m: string, ms = 5000) => { setMsg(m); setTimeout(() => setMsg(null), ms) }

  const saveClassification = async (id: string, value: string) => {
    setEditClass(null)
    await patch(id, { classification: value.trim() || null })
  }

  useEffect(() => {
    fetch('/api/card-accounts').then(r => r.json()).then(j => setCardAccounts(j.data ?? []))
    fetch('/api/accounts').then(r => r.json()).then(j => setAccounts(j.data ?? []))
  }, [])

  // 사이드바 카드별 링크 클릭 → URL 파라미터 변경을 필터에 반영
  const urlCardId = searchParams.get('cardAccountId') ?? ''
  useEffect(() => { setCardAccountId(urlCardId) }, [urlCardId])

  // 화면 내 드롭다운 변경 → URL에도 반영해 사이드바 하이라이트와 일치시킨다
  const changeCard = (id: string) => {
    setCardAccountId(id)
    router.replace(id ? `/card-expenses?cardAccountId=${id}` : '/card-expenses', { scroll: false })
  }

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
    if (Array.isArray(json.data)) setRows(json.data)
    else { showMsg(`조회 실패: ${json.error ?? '오류'}`); setRows([]) }
    setLoading(false)
  }, [cardAccountId, dateFrom, dateTo, status, search])

  useEffect(() => { load() }, [load])

  // 계정과목 필터: 확정 계정이 있으면 확정, 없으면 추천 계정 기준
  const effectiveAccount = (r: Expense) => r.confirmed ?? r.suggested

  const accountOptions = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>()
    let noneCount = 0
    for (const r of rows) {
      const acc = effectiveAccount(r)
      if (!acc) { noneCount++; continue }
      const cur = map.get(acc.code)
      if (cur) cur.count++
      else map.set(acc.code, { name: acc.name, count: 1 })
    }
    const list = Array.from(map.entries())
      .map(([code, v]) => ({ code, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    return { list, noneCount }
  }, [rows])

  const filteredRows = useMemo(() => rows.filter(r => {
    if (!accountFilter) return true
    if (accountFilter === 'none') return !effectiveAccount(r)
    return effectiveAccount(r)?.code === accountFilter
  }), [rows, accountFilter])

  const viewSummary = useMemo(() => ({
    count: filteredRows.length,
    approved_total: filteredRows.reduce((s, r) => s + (r.approved_amount || 0), 0),
    pending_count: filteredRows.filter(r => r.classify_status === 'pending').length,
  }), [filteredRows])

  // 선택 가능 = 현재 필터 결과의 미확정 행 (기확정 덮어쓰기 방지)
  const selectableIds = useMemo(
    () => filteredRows.filter(r => r.classify_status === 'pending').map(r => r.id),
    [filteredRows]
  )
  const selectedRows = useMemo(
    () => filteredRows.filter(r => r.classify_status === 'pending' && checked.has(r.id)),
    [filteredRows, checked]
  )

  // 필터·재조회로 화면에서 사라진 선택은 정리
  useEffect(() => {
    setChecked(prev => {
      const valid = new Set(selectableIds)
      const next = new Set(Array.from(prev).filter(id => valid.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [selectableIds])

  const allChecked = selectableIds.length > 0 && selectedRows.length === selectableIds.length
  useEffect(() => {
    if (headerCheckRef.current)
      headerCheckRef.current.indeterminate = selectedRows.length > 0 && !allChecked
  }, [selectedRows.length, allChecked])

  const toggleAll = () => {
    setChecked(allChecked ? new Set() : new Set(selectableIds))
  }
  const toggleOne = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/card-expenses/import', { method: 'POST', body: fd })
    const json = await res.json()
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
    if (!res.ok) { showMsg(`업로드 실패: ${json.error ?? '오류'}`); return }
    showMsg(`가져오기 완료: ${json.imported}건 — 신규 ${json.created ?? 0} · 기존갱신(중복) ${json.updated ?? 0} (카드사 ${json.card_companies ?? 1}개 · 카드 ${json.card_accounts}개 · 확정 ${json.confirmed} · 제안 ${json.suggested} · 건너뜀 ${json.skipped})`)
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

  // 일괄 확정 — approve: 추천 계정이 있는 건만 / assign: 선택 전부를 지정 계정으로
  const runBulk = async (kind: 'approve' | 'assign') => {
    if (bulkProgress) return
    const targets = kind === 'approve' ? selectedRows.filter(r => r.suggested) : selectedRows
    const skipped = selectedRows.length - targets.length
    if (kind === 'assign' && !bulkAccountId) { showMsg('확정할 계정과목을 먼저 선택하세요.'); return }
    if (targets.length === 0) {
      showMsg(kind === 'approve' ? '선택한 건에 추천 계정이 없습니다. 계정 직접 지정을 사용하세요.' : '처리할 대상이 없습니다.')
      return
    }

    let done = 0, fail = 0
    setBulkProgress(`0 / ${targets.length}`)
    const body = kind === 'approve'
      ? JSON.stringify({ approve: true })
      : JSON.stringify({ confirmed_account_id: bulkAccountId })
    for (let i = 0; i < targets.length; i += BULK_CONCURRENCY) {
      const chunk = targets.slice(i, i + BULK_CONCURRENCY)
      await Promise.all(chunk.map(async r => {
        try {
          const res = await fetch(`/api/card-expenses/${r.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
          })
          if (res.ok) done++
          else fail++
        } catch { fail++ }
      }))
      setBulkProgress(`${Math.min(i + BULK_CONCURRENCY, targets.length)} / ${targets.length}`)
    }
    setBulkProgress(null)
    setChecked(new Set())
    setBulkAccountId('')
    showMsg(
      `일괄 확정 완료: ${done}건`
      + (skipped > 0 ? ` · 추천 없음 제외 ${skipped}건` : '')
      + (fail > 0 ? ` · 실패 ${fail}건` : ''),
      8000
    )
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
        <select value={cardAccountId} onChange={e => changeCard(e.target.value)}
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
        <select value={accountFilter} onChange={e => setAccountFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
          <option value="">전체 계정과목</option>
          <option value="none">추천 없음 ({accountOptions.noneCount})</option>
          {accountOptions.list.map(a => (
            <option key={a.code} value={a.code}>{a.name} ({a.count})</option>
          ))}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="가맹점 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-44" />
      </div>

      {/* 요약 */}
      <div className="flex gap-3 flex-wrap mb-4">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">사용액 합계(승인금액)</p>
          <p className="text-lg font-bold text-gray-900">{won(viewSummary.approved_total)}</p>
          <p className="text-xs text-gray-400">{viewSummary.count.toLocaleString()}건</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">미확정(승인 필요)</p>
          <p className="text-lg font-bold text-amber-600">{viewSummary.pending_count.toLocaleString()}건</p>
        </div>
      </div>

      {/* 선택 일괄 작업 바 */}
      {selectedRows.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-3 px-4 py-2.5 bg-indigo-50 border border-indigo-200 rounded-xl text-sm text-indigo-900">
          <b>{selectedRows.length.toLocaleString()}건 선택</b>
          <span className="text-indigo-700">승인금액 {won(selectedRows.reduce((s, r) => s + (r.approved_amount || 0), 0))}</span>
          {bulkProgress ? (
            <span className="ml-2 font-medium">처리 중 {bulkProgress} — 창을 닫지 마세요</span>
          ) : (
            <>
              <button onClick={() => runBulk('approve')}
                className="ml-2 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-700">
                선택 승인 (추천 계정으로 확정)
              </button>
              <span className="inline-flex items-center gap-1.5">
                <select value={bulkAccountId} onChange={e => setBulkAccountId(e.target.value)}
                  className="border border-indigo-300 rounded-lg px-2 py-1.5 text-xs bg-white">
                  <option value="">계정 직접 지정...</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <button onClick={() => runBulk('assign')}
                  className="px-2.5 py-1.5 border border-indigo-300 bg-white text-indigo-800 rounded-lg text-xs font-semibold hover:bg-indigo-100">
                  선택에 적용
                </button>
              </span>
              <button onClick={() => setChecked(new Set())}
                className="ml-auto px-2.5 py-1.5 border border-indigo-300 bg-white text-indigo-800 rounded-lg text-xs hover:bg-indigo-100">
                선택 해제
              </button>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : filteredRows.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">표시할 데이터가 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 w-9">
                  <input ref={headerCheckRef} type="checkbox" checked={allChecked} onChange={toggleAll}
                    disabled={selectableIds.length === 0 || !!bulkProgress}
                    title="전체 선택 (현재 필터 결과의 미확정 건)" className="align-middle" />
                </th>
                <th className="py-2.5 px-3 font-medium">이용일시</th>
                <th className="py-2.5 px-3 font-medium">카드</th>
                <th className="py-2.5 px-3 font-medium">가맹점</th>
                <th className="py-2.5 px-3 font-medium text-right">승인금액</th>
                <th className="py-2.5 px-3 font-medium">계정과목</th>
                <th className="py-2.5 px-3 font-medium">분류</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(r => (
                <tr key={r.id} className={`border-b border-gray-100 ${checked.has(r.id) ? 'bg-indigo-50/60' : 'hover:bg-gray-50'}`}>
                  <td className="py-2 px-3">
                    <input type="checkbox"
                      checked={checked.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                      disabled={r.classify_status === 'confirmed' || !!bulkProgress}
                      title={r.classify_status === 'confirmed' ? '확정된 건은 선택할 수 없습니다 (개별 행에서만 변경)' : undefined}
                      className="align-middle" />
                  </td>
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
                  <td className="py-2 px-3 text-xs">
                    {editClass?.id === r.id ? (
                      <input
                        autoFocus
                        value={editClass.value}
                        onChange={e => setEditClass({ id: r.id, value: e.target.value })}
                        onBlur={() => saveClassification(r.id, editClass.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveClassification(r.id, editClass.value)
                          if (e.key === 'Escape') setEditClass(null)
                        }}
                        placeholder="분류 입력"
                        className="border border-slate-400 rounded px-1.5 py-1 text-xs w-28"
                      />
                    ) : (
                      <button
                        onClick={() => setEditClass({ id: r.id, value: r.classification ?? '' })}
                        className="text-left min-w-[60px] px-1 py-1 rounded hover:bg-gray-100 text-gray-500"
                        title="클릭하여 분류 수정"
                      >
                        {r.classification ?? <span className="text-gray-300">분류 +</span>}
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

// useSearchParams는 Suspense 경계가 필요 (transactions 페이지와 동일 패턴)
export default function CardExpensesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400 text-sm">로딩 중...</div>}>
      <CardExpensesContent />
    </Suspense>
  )
}
