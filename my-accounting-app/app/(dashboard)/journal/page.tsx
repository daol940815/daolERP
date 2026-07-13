'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getPeriodRange, PERIOD_PRESETS } from '@/lib/period-presets'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

interface Line {
  side: 'debit' | 'credit'
  amount: number
  note: string | null
  accounts: { code: string | null; name: string } | null
  vendors: { name: string } | null
}
interface Entry {
  id: string
  entry_no: string
  entry_date: string
  description: string | null
  source_type: string
  source_id: string | null
  entry_type: string
  journal_lines: Line[]
}

interface AccountOpt { id: string; code: string | null; name: string }
interface FormLine { account_id: string; side: 'debit' | 'credit'; amount: string }

const SOURCE: Record<string, { label: string; cls: string }> = {
  bank:        { label: '은행',       cls: 'bg-blue-100 text-blue-700' },
  card:        { label: '법인카드',   cls: 'bg-purple-100 text-purple-700' },
  card_sale:   { label: '카드매출',   cls: 'bg-pink-100 text-pink-700' },
  tax_invoice: { label: '세금계산서', cls: 'bg-green-100 text-green-700' },
  manual:      { label: '수동',       cls: 'bg-gray-100 text-gray-600' },
}

export default function JournalPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [summary, setSummary] = useState({ count: 0, total_amount: 0 })
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<AccountOpt[]>([])
  const [showManual, setShowManual] = useState(false)

  const [dateFrom, setDateFrom] = useState(() => getPeriodRange('당월').from)
  const [dateTo, setDateTo]     = useState(() => getPeriodRange('당월').to)
  const [sourceType, setSourceType] = useState('all')
  const [search, setSearch] = useState('')

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo) p.set('to', dateTo)
    if (sourceType !== 'all') p.set('sourceType', sourceType)
    if (search.trim()) p.set('q', search.trim())
    const res = await fetch(`/api/journal?${p}`)
    const json = await res.json()
    if (Array.isArray(json.data)) { setEntries(json.data); setSummary(json.summary) }
    else { flash(`조회 실패: ${json.error ?? '오류'}`); setEntries([]) }
    setLoading(false)
  }, [dateFrom, dateTo, sourceType, search])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetch('/api/accounts').then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d : d.data
      if (Array.isArray(list)) setAccounts(list.map((a: AccountOpt) => ({ id: a.id, code: a.code, name: a.name })))
    }).catch(() => null)
  }, [])

  const deleteManual = async (e: Entry) => {
    if (!e.source_id) return
    if (!confirm(`수동 분개 ${e.entry_no}을(를) 삭제할까요?`)) return
    const res = await fetch(`/api/journal/manual?sourceId=${e.source_id}`, { method: 'DELETE' })
    const json = await res.json()
    if (res.ok) { flash('삭제됨'); load() }
    else flash(`삭제 실패: ${json.error ?? '오류'}`)
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">분개장</h1>
          <p className="text-sm mt-1 text-gray-500">거래 확정 시 자동 생성된 분개(복식부기) + 수동 분개를 일자순으로 확인합니다.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => {
            const p = new URLSearchParams()
            if (dateFrom) p.set('from', dateFrom); if (dateTo) p.set('to', dateTo)
            if (sourceType !== 'all') p.set('sourceType', sourceType); if (search.trim()) p.set('q', search.trim())
            const a = document.createElement('a'); a.href = `/api/journal/export?${p}`; a.click()
          }}
            className="px-3.5 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 whitespace-nowrap">
            ↓ 엑셀
          </button>
          <button onClick={() => setShowManual(true)}
            className="px-3.5 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 whitespace-nowrap">
            + 수동 분개
          </button>
        </div>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {/* 기간 빠른 선택 */}
      <div className="flex flex-wrap items-center gap-1 mb-2 mt-3">
        {PERIOD_PRESETS.map(p => (
          <button key={p} onClick={() => { const r = getPeriodRange(p); setDateFrom(r.from); setDateTo(r.to) }}
            className="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-slate-100 hover:border-slate-400 transition-colors">
            {p}
          </button>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <select value={sourceType} onChange={e => setSourceType(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
          <option value="all">전체 출처</option>
          <option value="bank">은행</option>
          <option value="card">법인카드</option>
          <option value="card_sale">카드매출</option>
          <option value="tax_invoice">세금계산서</option>
          <option value="manual">수동</option>
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="전표번호·적요 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-52" />
      </div>

      {/* 요약 */}
      <div className="flex gap-3 flex-wrap mb-4">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">전표 수</p>
          <p className="text-lg font-bold text-gray-900">{summary.count.toLocaleString()}건</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">분개 금액 합계(차변)</p>
          <p className="text-lg font-bold text-gray-900">{won(summary.total_amount)}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">표시할 분개가 없습니다. (거래를 확정하면 자동 생성됩니다)</div>
      ) : (
        <div className="space-y-2">
          {entries.map(e => {
            const src = SOURCE[e.source_type] ?? { label: e.source_type, cls: 'bg-gray-100 text-gray-500' }
            return (
              <div key={e.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100 text-sm">
                  <span className="text-gray-500 whitespace-nowrap">{e.entry_date}</span>
                  <span className="font-mono text-xs text-gray-400">{e.entry_no}</span>
                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${src.cls}`}>{src.label}</span>
                  <span className="text-gray-900 truncate flex-1">{e.description ?? ''}</span>
                  {e.source_type === 'manual' && (
                    <button onClick={() => deleteManual(e)} className="text-xs text-gray-400 hover:text-red-600 shrink-0">삭제</button>
                  )}
                </div>
                <TAccount lines={e.journal_lines} />
              </div>
            )
          })}
        </div>
      )}

      {showManual && (
        <ManualJournalModal
          accounts={accounts}
          onClose={() => setShowManual(false)}
          onSaved={() => { setShowManual(false); flash('수동 분개 저장됨'); load() }}
        />
      )}
    </div>
  )
}

// ── T자형 분개 표시 (차변=좌 / 대변=우) ─────────────────────────────
function TAccount({ lines }: { lines: Line[] }) {
  const debits = lines.filter(l => l.side === 'debit')
  const credits = lines.filter(l => l.side === 'credit')
  const n = Math.max(debits.length, credits.length)
  const dtot = debits.reduce((s, l) => s + l.amount, 0)
  const ctot = credits.reduce((s, l) => s + l.amount, 0)

  const cell = (l: Line | undefined, color: string) => l ? (
    <div className="flex justify-between gap-2">
      <span className="text-gray-800">
        <span className="text-gray-400 text-xs mr-1">{l.accounts?.code ?? ''}</span>
        {l.accounts?.name ?? '(계정)'}
        {l.vendors?.name ? <span className="text-gray-400"> · {l.vendors.name}</span> : null}
      </span>
      <span className={`text-right whitespace-nowrap tabular-nums ${color}`}>{won(l.amount)}</span>
    </div>
  ) : null

  return (
    <table className="w-full text-sm table-fixed">
      <thead>
        <tr className="text-[11px] text-gray-400 border-b border-gray-100">
          <th className="py-1 px-3 text-left font-medium w-1/2">차변</th>
          <th className="py-1 px-3 text-left font-medium w-1/2 border-l border-gray-100">대변</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: n }).map((_, i) => (
          <tr key={i} className="border-b border-gray-50 last:border-0 align-top">
            <td className="py-1.5 px-3">{cell(debits[i], 'text-blue-700')}</td>
            <td className="py-1.5 px-3 border-l border-gray-100">{cell(credits[i], 'text-red-700')}</td>
          </tr>
        ))}
        <tr className="bg-gray-50/70 text-xs border-t border-gray-100">
          <td className="py-1 px-3 text-right text-blue-700 tabular-nums">합계 {won(dtot)}</td>
          <td className="py-1 px-3 text-right text-red-700 tabular-nums border-l border-gray-100">합계 {won(ctot)}</td>
        </tr>
      </tbody>
    </table>
  )
}

// ── 수동 분개 입력 모달 ────────────────────────────────────────────
function ManualJournalModal({
  accounts, onClose, onSaved,
}: {
  accounts: AccountOpt[]
  onClose: () => void
  onSaved: () => void
}) {
  const today = new Date()
  const fmt = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const [entryDate, setEntryDate] = useState(fmt)
  const [description, setDescription] = useState('')
  const [lines, setLines] = useState<FormLine[]>([
    { account_id: '', side: 'debit', amount: '' },
    { account_id: '', side: 'credit', amount: '' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const num = (s: string) => Number((s || '').replace(/,/g, '').trim() || 0)
  const debit = useMemo(() => lines.filter(l => l.side === 'debit').reduce((s, l) => s + num(l.amount), 0), [lines])
  const credit = useMemo(() => lines.filter(l => l.side === 'credit').reduce((s, l) => s + num(l.amount), 0), [lines])
  const balanced = debit === credit && debit > 0

  const setLine = (i: number, patch: Partial<FormLine>) =>
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  const addLine = () => setLines(ls => [...ls, { account_id: '', side: 'debit', amount: '' }])
  const removeLine = (i: number) => setLines(ls => ls.length > 2 ? ls.filter((_, idx) => idx !== i) : ls)

  const save = async () => {
    setError(null)
    if (!balanced) { setError('차변과 대변 합계가 일치해야 합니다.'); return }
    if (lines.some(l => !l.account_id || num(l.amount) <= 0)) { setError('모든 라인에 계정과 금액을 입력하세요.'); return }
    setSaving(true)
    const res = await fetch('/api/journal/manual', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry_date: entryDate,
        description,
        lines: lines.map(l => ({ account_id: l.account_id, side: l.side, amount: num(l.amount) })),
      }),
    })
    const json = await res.json()
    setSaving(false)
    if (res.ok) onSaved()
    else setError(json.error ?? '저장 실패')
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-5 w-full max-w-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900 mb-3">수동 분개 입력</h3>
        {error && <p className="text-red-500 text-xs mb-2">{error}</p>}

        <div className="flex items-center gap-2 mb-3">
          <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="적요"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm flex-1" />
        </div>

        <table className="w-full text-sm mb-2">
          <thead>
            <tr className="text-gray-400 text-xs">
              <th className="text-left font-medium pb-1">계정과목</th>
              <th className="text-left font-medium pb-1 w-24">구분</th>
              <th className="text-right font-medium pb-1 w-36">금액</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <select value={l.account_id} onChange={e => setLine(i, { account_id: e.target.value })}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
                    <option value="">계정 선택…</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} ` : ''}{a.name}</option>)}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <select value={l.side} onChange={e => setLine(i, { side: e.target.value as 'debit' | 'credit' })}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
                    <option value="debit">차변</option>
                    <option value="credit">대변</option>
                  </select>
                </td>
                <td className="py-1">
                  <input value={l.amount} onChange={e => setLine(i, { amount: e.target.value })} placeholder="0"
                    className="w-full text-right border border-gray-300 rounded px-2 py-1 text-sm" />
                </td>
                <td className="py-1 text-center">
                  <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500 text-sm">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button onClick={addLine} className="text-xs text-slate-600 hover:text-slate-900 mb-3">+ 라인 추가</button>

        <div className="flex items-center justify-between border-t border-gray-100 pt-3 text-sm">
          <div className="flex gap-4">
            <span className="text-gray-500">차변 <b className="text-blue-700">{debit.toLocaleString()}</b></span>
            <span className="text-gray-500">대변 <b className="text-red-700">{credit.toLocaleString()}</b></span>
            <span className={balanced ? 'text-green-600' : 'text-amber-600'}>{balanced ? '✓ 균형' : '불균형'}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">취소</button>
            <button onClick={save} disabled={saving || !balanced}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
