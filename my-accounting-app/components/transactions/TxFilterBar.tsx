'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import SearchableSelect from '@/components/ui/SearchableSelect'
import type { Account } from '@/types/transaction'
import type { Vendor } from '@/types/tax-invoice'
import type { BankAccount } from '@/types/bank-account'
import {
  FILTER_LABEL, STATUS_LABEL, SOURCE_LABEL, LINK_LABEL, DIR_LABEL, QUICK_FILTERS,
  describeFilter, mergeFilters, parseNum, parseQuery, sameFilter,
  type TxFilter, type TxFilterKind, type AmountDir, type AmountOp, type TxStatus, type TxSource, type LinkKind,
} from '@/lib/tx-filter'

// 통장 내역 검색 줄 — [+ 필터 ▾][검색창] + 적용 중 칩 + 빠른 조건 (승인 시안 2026-11-10 수정 2)
// 필터 설정은 드롭다운(항목 선택 → 값 입력 → 추가)이 기본, 검색창의 "금액:168300" 단축 입력은 보조.

const ITEMS: TxFilterKind[] = ['amount', 'account', 'vendor', 'status', 'bank', 'source', 'memo', 'date', 'link']

interface Draft {
  kind: TxFilterKind
  dir: AmountDir; op: AmountOp; a: string; b: string
  name: string
  statuses: TxStatus[]
  bankText: string
  sources: TxSource[]
  memo: string
  dateMonth: string; dateDay: string
  link: LinkKind
}
const emptyDraft = (kind: TxFilterKind): Draft => ({
  kind, dir: 'any', op: 'range', a: '', b: '', name: '', statuses: ['pending'], bankText: '', sources: ['bank'],
  memo: '', dateMonth: '', dateDay: '', link: 'transfer',
})
const draftFrom = (f: TxFilter): Draft => {
  const d = emptyDraft(f.kind)
  switch (f.kind) {
    case 'amount': d.dir = f.dir; d.op = f.op === 'none' ? 'range' : f.op; d.a = f.a == null ? '' : String(f.a); d.b = f.b == null ? '' : String(f.b); break
    case 'account': case 'vendor': d.name = f.name; break
    case 'status': d.statuses = f.values; break
    case 'bank': d.bankText = f.text; break
    case 'source': d.sources = f.values; break
    case 'memo': d.memo = f.text; break
    case 'date': if (f.value.length === 7) d.dateMonth = f.value; else d.dateDay = f.value; break
    case 'link': d.link = f.value; break
  }
  return d
}
// 입력값이 비어 있으면(방향만 고른 금액 등) 그에 맞는 필터를, 성립하지 않으면 null
const draftToFilter = (d: Draft): TxFilter | null => {
  switch (d.kind) {
    case 'amount': {
      const a = parseNum(d.a), b = parseNum(d.b)
      if (a == null && b == null) return d.dir === 'any' ? null : { kind: 'amount', dir: d.dir, op: 'none', a: null, b: null }
      if (d.op === 'range') return { kind: 'amount', dir: d.dir, op: 'range', a, b }
      if (a == null) return null
      return { kind: 'amount', dir: d.dir, op: d.op, a, b: null }
    }
    case 'account': return d.name ? { kind: 'account', name: d.name } : null
    case 'vendor':  return d.name ? { kind: 'vendor', name: d.name } : null
    case 'status':  return d.statuses.length ? { kind: 'status', values: d.statuses } : null
    case 'bank':    return d.bankText.trim() ? { kind: 'bank', text: d.bankText.trim() } : null
    case 'source':  return d.sources.length ? { kind: 'source', values: d.sources } : null
    case 'memo':    return d.memo.trim() ? { kind: 'memo', text: d.memo.trim() } : null
    case 'date':    return d.dateDay ? { kind: 'date', value: d.dateDay } : d.dateMonth ? { kind: 'date', value: d.dateMonth } : null
    case 'link':    return { kind: 'link', value: d.link }
    default: return null
  }
}

const chipCls = (kind: TxFilterKind) =>
  kind === 'text'   ? 'bg-slate-100 border-slate-200 text-slate-800' :
  kind === 'amount' ? 'bg-sky-50 border-sky-300 text-sky-800' :
  kind === 'status' ? 'bg-amber-50 border-amber-300 text-amber-800' :
                      'bg-indigo-50 border-indigo-200 text-indigo-800'

const inputCls = 'border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900'

export default function TxFilterBar({ filters, onChange, accounts, vendors, banks, matched, total }: {
  filters: TxFilter[]
  onChange: (next: TxFilter[]) => void
  accounts: Account[]
  vendors: Vendor[]
  banks: BankAccount[]
  matched: number
  total: number
}) {
  const [qInput, setQInput] = useState('')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => emptyDraft('amount'))
  const panelRef = useRef<HTMLDivElement>(null)
  const btnRef   = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return
      // SearchableSelect 패널은 position:fixed로 body에 뜨므로 그 안 클릭은 닫지 않는다
      if ((e.target as HTMLElement).closest?.('[data-tx-filter-keep]')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const accountOptions = useMemo(() => [
    { id: '없음', label: '(미분류 — 확정·추천 없음)' },
    { id: '추천', label: '(추천만 있음 — 미확정)' },
    ...accounts.filter(a => a.is_active !== false).map(a => ({ id: a.name, label: a.code ? `${a.code} ${a.name}` : a.name })),
  ], [accounts])
  const vendorOptions = useMemo(() => {
    const seen = new Set<string>()
    const list = [{ id: '없음', label: '(미지정)' }]
    for (const v of vendors) {
      if (v.is_active === false || seen.has(v.name)) continue
      seen.add(v.name); list.push({ id: v.name, label: v.name })
    }
    return list
  }, [vendors])
  const bankOptions = useMemo(() => {
    const seen = new Set<string>()
    const list: { id: string; label: string }[] = []
    for (const b of banks) {
      const key = b.alias || b.bank_name
      if (!key || seen.has(key)) continue
      seen.add(key); list.push({ id: key, label: b.alias ? `${b.alias} (${b.bank_name})` : b.bank_name })
    }
    return list
  }, [banks])

  const commitInput = () => {
    const parsed = parseQuery(qInput)
    if (parsed.length) onChange(mergeFilters([...filters, ...parsed]))
    setQInput('')
  }
  const remove = (f: TxFilter) => onChange(filters.filter(x => !sameFilter(x, f)))
  const edit = (f: TxFilter) => {
    if (f.kind === 'text') return
    setDraft(draftFrom(f)); setOpen(true)
  }
  const apply = () => {
    const f = draftToFilter(draft)
    if (!f) return
    onChange(mergeFilters([...filters, f]))
    setOpen(false)
  }
  const toggleQuick = (f: TxFilter) => {
    const on = filters.some(x => sameFilter(x, f))
    onChange(on ? filters.filter(x => !sameFilter(x, f)) : mergeFilters([...filters, f]))
  }

  const current = filters.find(f => f.kind === draft.kind)
  const draftValid = !!draftToFilter(draft)

  return (
    <div className="mb-3">
      {/* 검색 줄 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)}
            className={`px-3 py-1.5 border rounded-lg text-sm font-medium ${open ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-900 border-slate-900 hover:bg-slate-50'}`}>
            + 필터 ▾
          </button>
          {open && (
            <div ref={panelRef} data-tx-filter-keep className="absolute left-0 top-10 z-30 w-[560px] max-w-[95vw] bg-white border border-gray-200 rounded-xl shadow-xl p-3 text-xs">
              <div className="flex gap-3">
                <div className="w-32 shrink-0 border-r border-gray-100 pr-2">
                  <div className="text-gray-400 mb-1">필터 항목</div>
                  {ITEMS.map(k => {
                    const active = filters.some(f => f.kind === k)
                    return (
                      <button key={k} type="button" onClick={() => setDraft(() => { const f = filters.find(x => x.kind === k); return f ? draftFrom(f) : emptyDraft(k) })}
                        className={`block w-full text-left px-2 py-1.5 rounded ${draft.kind === k ? 'bg-slate-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}>
                        {FILTER_LABEL[k]}{active && <span className={`ml-1 ${draft.kind === k ? 'text-slate-300' : 'text-sky-600'}`}>●</span>}
                      </button>
                    )
                  })}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-gray-400 mb-1">{FILTER_LABEL[draft.kind]} 조건{current && <span className="ml-1 text-sky-600">(적용 중인 값을 수정합니다)</span>}</div>

                  {draft.kind === 'amount' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <select value={draft.dir} onChange={e => setDraft(d => ({ ...d, dir: e.target.value as AmountDir }))} className={inputCls}>
                        {(Object.keys(DIR_LABEL) as AmountDir[]).map(k => <option key={k} value={k}>{DIR_LABEL[k]}</option>)}
                      </select>
                      <select value={draft.op} onChange={e => setDraft(d => ({ ...d, op: e.target.value as AmountOp }))} className={inputCls}>
                        <option value="range">범위</option><option value="eq">같음</option><option value="gte">이상</option><option value="lte">이하</option>
                      </select>
                      <input value={draft.a} onChange={e => setDraft(d => ({ ...d, a: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') apply() }}
                        placeholder={draft.op === 'range' ? '최소' : '금액'} inputMode="numeric" className={`${inputCls} w-28 text-right`} />
                      {draft.op === 'range' && (<>
                        <span className="text-gray-400">~</span>
                        <input value={draft.b} onChange={e => setDraft(d => ({ ...d, b: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') apply() }}
                          placeholder="최대" inputMode="numeric" className={`${inputCls} w-28 text-right`} />
                      </>)}
                      <p className="w-full text-gray-400">숫자만 입력(쉼표 가능). 값 없이 방향만 고르면 입금만·출금만 필터가 됩니다.</p>
                    </div>
                  )}

                  {(draft.kind === 'account' || draft.kind === 'vendor') && (
                    <div data-tx-filter-keep>
                      <SearchableSelect value={draft.name} onChange={v => setDraft(d => ({ ...d, name: v }))}
                        options={draft.kind === 'account' ? accountOptions : vendorOptions}
                        emptyLabel={draft.kind === 'account' ? '계정과목 선택…' : '거래처 선택…'}
                        className={`${inputCls} w-full bg-white`} />
                      <p className="text-gray-400 mt-1">{draft.kind === 'account' ? '확정 계정 또는 추천 계정이 일치하는 행. 검색창에 계정:임차료 처럼 쳐도 됩니다.' : '연결된 거래처가 일치하는 행. 검색창에 거래처:에스원 처럼 쳐도 됩니다.'}</p>
                    </div>
                  )}

                  {draft.kind === 'status' && (
                    <div className="flex flex-wrap gap-3">
                      {(Object.keys(STATUS_LABEL) as TxStatus[]).map(s => (
                        <label key={s} className="inline-flex items-center gap-1">
                          <input type="checkbox" checked={draft.statuses.includes(s)}
                            onChange={e => setDraft(d => ({ ...d, statuses: e.target.checked ? [...d.statuses, s] : d.statuses.filter(x => x !== s) }))} />
                          {STATUS_LABEL[s]}
                        </label>
                      ))}
                    </div>
                  )}

                  {draft.kind === 'bank' && (
                    <div data-tx-filter-keep>
                      <SearchableSelect value={draft.bankText} onChange={v => setDraft(d => ({ ...d, bankText: v }))}
                        options={bankOptions} emptyLabel="계좌 선택…" className={`${inputCls} w-full bg-white`} />
                      <p className="text-gray-400 mt-1">불러온 행의 계좌 별칭으로 좁힙니다. 사이드바 계좌 바로가기(서버 조회)와는 별개입니다.</p>
                    </div>
                  )}

                  {draft.kind === 'source' && (
                    <div className="flex flex-wrap gap-3">
                      {(Object.keys(SOURCE_LABEL) as TxSource[]).map(s => (
                        <label key={s} className="inline-flex items-center gap-1">
                          <input type="checkbox" checked={draft.sources.includes(s)}
                            onChange={e => setDraft(d => ({ ...d, sources: e.target.checked ? [...d.sources, s] : d.sources.filter(x => x !== s) }))} />
                          {SOURCE_LABEL[s]}
                        </label>
                      ))}
                    </div>
                  )}

                  {draft.kind === 'memo' && (
                    <input value={draft.memo} onChange={e => setDraft(d => ({ ...d, memo: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') apply() }}
                      placeholder="메모에 포함된 글자" className={`${inputCls} w-full`} autoFocus />
                  )}

                  {draft.kind === 'date' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-gray-500">월</span>
                      <input type="month" value={draft.dateMonth} onChange={e => setDraft(d => ({ ...d, dateMonth: e.target.value, dateDay: '' }))} className={inputCls} />
                      <span className="text-gray-400">또는 일</span>
                      <input type="date" value={draft.dateDay} onChange={e => setDraft(d => ({ ...d, dateDay: e.target.value, dateMonth: '' }))} className={inputCls} />
                      <p className="w-full text-gray-400">조회한 기간 안에서 다시 좁힙니다. 기간 자체는 위 기간 줄에서 바꿉니다.</p>
                    </div>
                  )}

                  {draft.kind === 'link' && (
                    <div className="flex flex-wrap gap-3">
                      {(Object.keys(LINK_LABEL) as LinkKind[]).map(k => (
                        <label key={k} className="inline-flex items-center gap-1">
                          <input type="radio" name="tx-link" checked={draft.link === k} onChange={() => setDraft(d => ({ ...d, link: k }))} />
                          {LINK_LABEL[k]}
                        </label>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-end gap-2 mt-3">
                    {current && (
                      <button type="button" onClick={() => { remove(current); setOpen(false) }} className="px-2.5 py-1 border border-red-200 text-red-600 rounded hover:bg-red-50">이 필터 제거</button>
                    )}
                    <button type="button" onClick={() => setOpen(false)} className="px-2.5 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-50">취소</button>
                    <button type="button" onClick={apply} disabled={!draftValid} className="px-2.5 py-1 bg-slate-900 text-white rounded disabled:opacity-40">{current ? '수정 적용' : '필터 추가'}</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="relative flex-1 min-w-[260px]">
          <input value={qInput} onChange={e => setQInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); commitInput() } }}
            placeholder="검색어 입력 후 Enter — 적요·보낸분/받는분·메모·거래처·계정과목 (금액:168300 같은 단축 입력도 가능)"
            className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
          <span className="absolute left-2.5 top-1.5 text-gray-400 text-sm">⌕</span>
        </div>
      </div>

      {/* 적용 중 칩 + 빠른 조건 */}
      <div className="flex flex-wrap items-center gap-1.5 mt-2 text-xs">
        {filters.length > 0 ? (<>
          <span className="text-gray-400">적용 중:</span>
          {filters.map((f, i) => {
            const d = describeFilter(f)
            const editable = f.kind !== 'text'
            return (
              <span key={i} className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${chipCls(f.kind)} ${editable ? 'cursor-pointer' : ''}`}
                title={editable ? '클릭해 수정' : undefined} onClick={() => edit(f)}>
                {d.label} <b>{d.value}</b>
                <button type="button" onClick={e => { e.stopPropagation(); remove(f) }} className="ml-0.5 opacity-60 hover:opacity-100" title="제거">✕</button>
              </span>
            )
          })}
          <button type="button" onClick={() => onChange([])} className="px-2 py-1 rounded-full border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50">모두 지우기</button>
          <span className="text-gray-400 ml-1">조건 일치 <b className="text-gray-900">{matched.toLocaleString('ko-KR')}건</b> / 기간 내 {total.toLocaleString('ko-KR')}건</span>
          <span className="text-gray-300 mx-1">|</span>
        </>) : null}
        <span className="text-gray-400">빠른 조건:</span>
        {QUICK_FILTERS.map(q => {
          const on = filters.some(x => sameFilter(x, q.filter))
          return (
            <button key={q.label} type="button" onClick={() => toggleQuick(q.filter)}
              className={`px-2 py-1 rounded-full border ${on ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'}`}>
              {q.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
