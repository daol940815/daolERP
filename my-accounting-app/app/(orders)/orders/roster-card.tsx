'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RosterItemCandidate, RosterRowInput } from '@/lib/delivery-roster'

// 개별 배송 명단 카드 (707, 2026-11-09 사용자 확정 — 시안 docs/mockups/개별배송명단_시안.html v2.2)
//  - 폼에는 요약(KPI · 미리보기 3행)만, 행 편집은 "명단 열기" 전용 패널(드로어 · 문제 필터 · 검색 · 50행 페이지)
//  - 표준 양식 엑셀만 업로드(헤더 고정) · 재업로드 = 교체 · 원본 파일 보관 · 다운로드 기록
//  - 우편번호: 항목만 두고 확인·경고 없음. 주소 앞에 붙이지 않는다
//  - 상담·주문 공용: consultationId 또는 orderId 중 하나. 저장된 문서에서만 열린다(신규는 안내)

interface Row extends RosterRowInput { _key: string; _dirty?: boolean; _new?: boolean }
interface RosterHead {
  id: string; consultation_id: string | null; order_id: string | null
  file_name: string | null; storage_path: string | null; created_at: string; uploader_name: string | null
}
interface Summary {
  row_count: number; recipient_count: number; roster_qty: number; unlinked: number; no_phone: number
  qty_check: { item_name: string; item_qty: number; roster_qty: number }[]; mismatch_count: number
}
type Filter = 'all' | 'unlinked' | 'nophone' | 'dirty'
const PAGE = 50
const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, '').toLowerCase()
const t = (v: unknown) => { const s = String(v ?? '').trim(); return s || null }
let keySeq = 0
const nextKey = () => `k${Date.now()}_${++keySeq}`
const fmtTime = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function RosterCard({ consultationId, orderId, applies, isNew, disabled, subject, newHint }: {
  consultationId?: string | null
  orderId?: string | null
  applies: boolean          // 개별 배송 품목이 있는지 (없고 명단도 없으면 카드 숨김)
  isNew?: boolean           // 저장 전 문서 — 업로드 불가 안내
  disabled?: boolean        // 잠금(전환 후 · 읽기 전용)
  subject?: string          // 패널 제목 보조 (예: 온양농협 배방지점 상담 2026-11-06)
  newHint?: string          // isNew일 때 안내 문구 대체
}) {
  const key = consultationId ? `consultation_id=${consultationId}` : orderId ? `order_id=${orderId}` : null
  const [roster, setRoster] = useState<RosterHead | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [deleted, setDeleted] = useState<string[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [cands, setCands] = useState<RosterItemCandidate[]>([])
  const [hint, setHint] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [applyHint, setApplyHint] = useState<{ raw: string; cand: RosterItemCandidate; count: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!key) return
    setLoading(true)
    try {
      const res = await fetch(`/api/orders-portal/rosters?${key}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setNotice({ kind: 'err', text: json.error ?? '명단 조회 실패' }); return }
      setHint(json.hint ?? null)
      setRoster(json.roster ?? null)
      setRows(((json.rows ?? []) as RosterRowInput[]).map(r => ({ ...r, _key: r.id ?? nextKey() })))
      setDeleted([])
      setSummary(json.summary ?? null)
      setCands(json.candidates ?? [])
    } finally { setLoading(false) }
  }, [key])
  useEffect(() => { load() }, [load])

  const dirtyCount = rows.filter(r => r._dirty || r._new).length + deleted.length
  const unlinkedRows = rows.filter(r => !r.item_name).length
  const noPhoneRows = rows.filter(r => !r.phone).length

  // 명단 수량 vs 품목 수량 — 명단에 등장하는 품목만 합산 (지점·샘플 품목은 명단 대상이 아니라 제외)
  const qty = useMemo(() => {
    if (!summary) return null
    const used = summary.qty_check.filter(x => x.roster_qty > 0)
    return { roster: summary.roster_qty, item: used.reduce((s, x) => s + x.item_qty, 0), mismatch: summary.mismatch_count }
  }, [summary])

  const filtered = useMemo(() => {
    const q = norm(search)
    return rows.filter(r => {
      if (filter === 'unlinked' && r.item_name) return false
      if (filter === 'nophone' && r.phone) return false
      if (filter === 'dirty' && !(r._dirty || r._new)) return false
      if (q && !norm([r.recipient_name, r.phone, r.addr1, r.addr2, r.item_name_raw, r.item_name, r.memo].join(' ')).includes(q)) return false
      return true
    })
  }, [rows, filter, search])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE))
  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE)
  useEffect(() => { setPage(0) }, [filter, search])

  const openPanel = (f: Filter = 'all') => { setFilter(f); setSearch(''); setOpen(true) }
  const closePanel = () => {
    if (dirtyCount && !window.confirm('저장하지 않은 수정이 있습니다. 닫으면 사라집니다. 닫을까요?')) return
    setOpen(false); setApplyHint(null)
    if (dirtyCount) load()
  }

  const patch = (k: string, p: Partial<RosterRowInput>) =>
    setRows(rs => rs.map(r => r._key === k ? { ...r, ...p, _dirty: true } : r))

  const pickItem = (row: Row, name: string) => {
    const c = cands.find(x => x.item_name === name) ?? null
    patch(row._key, { item_name: c?.item_name ?? null, product_id: c?.product_id ?? null, item_code: c?.item_code ?? null })
    // 같은 상품명(원문)의 다른 미연결 행에도 적용 제안
    const raw = t(row.item_name_raw)
    if (c && raw) {
      const n = rows.filter(r => r._key !== row._key && !r.item_name && norm(r.item_name_raw) === norm(raw)).length
      setApplyHint(n ? { raw, cand: c, count: n } : null)
    } else setApplyHint(null)
  }
  const applyAll = () => {
    if (!applyHint) return
    const { raw, cand } = applyHint
    setRows(rs => rs.map(r => !r.item_name && norm(r.item_name_raw) === norm(raw)
      ? { ...r, item_name: cand.item_name, product_id: cand.product_id, item_code: cand.item_code, _dirty: true } : r))
    setApplyHint(null)
  }
  const addRow = () => {
    const seq = rows.reduce((m, r) => Math.max(m, r.seq), 0) + 1
    setRows(rs => [...rs, {
      _key: nextKey(), _new: true, id: null, seq, recipient_name: null, phone: null, zip: null, addr1: null, addr2: null,
      item_name_raw: null, product_id: null, item_code: null, item_name: null, quantity: 1, memo: null,
    }])
    setFilter('all'); setSearch('')
    setPage(Math.floor(rows.length / PAGE))
  }
  const removeRow = (row: Row) => {
    if (!window.confirm(`${row.seq}번 행(${row.recipient_name ?? '수령인 없음'})을 삭제할까요?`)) return
    setRows(rs => rs.filter(r => r._key !== row._key))
    if (row.id) setDeleted(d => [...d, row.id as string])
  }

  const save = async () => {
    if (!roster || !dirtyCount) return
    setBusy(true); setNotice(null)
    try {
      const res = await fetch(`/api/orders-portal/rosters/${roster.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: rows.filter(r => r._dirty || r._new).map(r => ({
            id: r.id ?? null, seq: r.seq, recipient_name: r.recipient_name, phone: r.phone, zip: r.zip, addr1: r.addr1, addr2: r.addr2,
            item_name_raw: r.item_name_raw, item_name: r.item_name, quantity: r.quantity, memo: r.memo,
          })),
          deleted, order_id: orderId ?? null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setNotice({ kind: 'err', text: json.error ?? '저장 실패' }); return }
      setNotice({ kind: 'ok', text: '명단을 저장했습니다.' })
      setApplyHint(null)
      await load()
    } finally { setBusy(false) }
  }

  const upload = async (file: File) => {
    if (!key) return
    if (roster && !window.confirm(`기존 명단(${rows.length}행)을 이 파일로 교체합니다. 직접 고친 내용도 사라집니다. 계속할까요?`)) return
    setBusy(true); setNotice(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (consultationId) fd.append('consultation_id', consultationId)
      else if (orderId) fd.append('order_id', orderId)
      const res = await fetch('/api/orders-portal/rosters', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setNotice({ kind: 'err', text: json.error ?? '업로드 실패' }); return }
      const s = json.summary as Summary | undefined
      const parts = [`${json.row_count}행 저장`]
      if (json.skipped) parts.push(`${json.skipped}행 건너뜀(수령인 · 주소 없음)`)
      if (s?.unlinked) parts.push(`품목 미연결 ${s.unlinked}건 — 명단 열기에서 연결해주세요`)
      setNotice({ kind: s?.unlinked ? 'err' : 'ok', text: `업로드 완료 — ${parts.join(' · ')}` })
      await load()
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const removeRoster = async () => {
    if (!roster) return
    if (!window.confirm(`배송명단 ${rows.length}행을 전부 삭제합니다(원본 파일 포함). 계속할까요?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/orders-portal/rosters/${roster.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setNotice({ kind: 'err', text: json.error ?? '삭제 실패' }); return }
      setOpen(false)
      await load()
    } finally { setBusy(false) }
  }

  const download = (kind: 'excel' | 'original') => {
    if (!roster) return
    window.open(`/api/orders-portal/rosters/${roster.id}/download?kind=${kind}`, '_blank')
  }

  if (!key) return null
  if (!applies && !roster && !loading) return null

  const btn = 'px-2.5 py-1 text-[0.75rem] border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap'
  const btnBlue = 'px-2.5 py-1 text-[0.75rem] border border-blue-200 rounded-md text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap'
  const btnDark = 'px-2.5 py-1 text-[0.75rem] rounded-md text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap'
  const badge = 'inline-block px-1.5 py-px rounded-full text-[0.625rem] font-semibold whitespace-nowrap'
  const fromConsult = !!(orderId && roster?.consultation_id)
  const preview = rows.slice(0, 3)

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <div className="text-sm font-bold text-gray-900">
          배송명단 <span className="text-[0.6875rem] font-normal text-gray-400 ml-1">
            {fromConsult ? '상담일지에서 승계 · 이 주문에 포함된 품목의 수령인 행만' : '개별 배송 품목 · 수령인별 · 표준 양식 엑셀'}
          </span>
        </div>
        <div className="ml-auto flex gap-1.5 flex-wrap">
          <a href="/api/orders-portal/rosters/template" className={btnBlue}>양식 다운로드</a>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} />
          <button type="button" className={btnDark} disabled={disabled || isNew || busy || !!hint}
            onClick={() => fileRef.current?.click()}>{roster ? '다시 업로드' : '엑셀 업로드'}</button>
          {roster && <button type="button" className={btn} onClick={() => openPanel()}>명단 열기 ({rows.length}행)</button>}
          {roster && <button type="button" className={btn} onClick={() => download('excel')}>엑셀 다운로드</button>}
          {roster?.storage_path && <button type="button" className={btn} onClick={() => download('original')}>원본 다운로드</button>}
        </div>
      </div>

      {hint && (
        <div className="mb-2 text-xs px-3 py-1.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">{hint}</div>
      )}
      {notice && (
        <div className={`mb-2 text-xs px-3 py-1.5 rounded-lg border ${notice.kind === 'ok'
          ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>{notice.text}</div>
      )}

      {isNew ? (
        <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 leading-relaxed">
          {newHint ?? '먼저 저장하면 배송명단을 올릴 수 있습니다. 양식은 지금 내려받아 작성해두세요.'}
        </div>
      ) : !roster ? (
        <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 leading-relaxed">
          {loading ? '명단을 불러오는 중...' : <>
            아직 올린 명단이 없습니다. <b>양식 다운로드</b>로 받은 파일에 수령인을 적어 <b>엑셀 업로드</b>하세요 —
            상품명을 품목의 상품명과 같게 적으면 자동 연결됩니다. 우편번호는 비워도 됩니다.
            {fromConsult === false && orderId && <span className="text-gray-400"> 상담에서 전환된 주문은 상담 명단이 자동으로 따라옵니다.</span>}
          </>}
        </div>
      ) : (
        <>
          <div className={`flex items-center gap-2 flex-wrap text-xs rounded-lg px-3 py-1.5 border mb-2 ${
            fromConsult ? 'bg-blue-50 border-blue-200 text-blue-900' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
            {fromConsult
              ? <>상담일지의 배송명단 <b>{rows.length}행</b>이 이 주문에 연결되었습니다. 수정은 여기(주문)에서 합니다.</>
              : <>업로드 완료 — <b>{roster.file_name ?? '직접 작성'}</b> {summary?.row_count ?? rows.length}행
                  ({fmtTime(roster.created_at)}{roster.uploader_name ? `, ${roster.uploader_name}` : ''}){roster.storage_path ? ' · 원본 파일 보관' : ''}</>}
          </div>

          <div className="flex gap-2 flex-wrap mb-2">
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-[0.71875rem] text-gray-600">
              수령인 <b className="text-gray-900 text-sm ml-0.5">{summary?.recipient_count ?? 0}</b>명 · <b className="text-gray-900 text-sm">{rows.length}</b>행
            </div>
            {qty && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-[0.71875rem] text-gray-600">
                명단 수량 <b className="text-gray-900 text-sm ml-0.5">{qty.roster}</b> / 품목 수량 <b className="text-gray-900 text-sm">{qty.item}</b>
                {qty.item > 0 && (qty.mismatch
                  ? <span className={`${badge} bg-red-100 text-red-700 ml-1.5`}>{qty.roster > qty.item ? `+${qty.roster - qty.item} 초과` : qty.roster < qty.item ? `${qty.roster - qty.item} 부족` : `품목별 불일치 ${qty.mismatch}`}</span>
                  : <span className={`${badge} bg-emerald-100 text-emerald-700 ml-1.5`}>일치</span>)}
              </div>
            )}
            <button type="button" onClick={() => openPanel('unlinked')}
              className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-[0.71875rem] text-gray-600 hover:bg-gray-100 text-left">
              품목 미연결 <b className="text-gray-900 text-sm ml-0.5">{unlinkedRows}</b>건
              {unlinkedRows > 0 && <span className={`${badge} bg-red-100 text-red-700 ml-1.5`}>확인 필요 →</span>}
            </button>
            <button type="button" onClick={() => openPanel('nophone')}
              className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-[0.71875rem] text-gray-600 hover:bg-gray-100 text-left">
              연락처 없음 <b className="text-gray-900 text-sm ml-0.5">{noPhoneRows}</b>건
              {noPhoneRows > 0 && <span className={`${badge} bg-amber-100 text-amber-800 ml-1.5`}>확인 권장 →</span>}
            </button>
          </div>

          <table className="w-full text-[0.71875rem]">
            <thead>
              <tr className="text-[0.65625rem] text-gray-500 bg-gray-50">
                <th className="px-2 py-1 text-center font-medium w-10">NO</th>
                <th className="px-2 py-1 text-left font-medium">수령인</th>
                <th className="px-2 py-1 text-left font-medium">연락처</th>
                <th className="px-2 py-1 text-left font-medium">주소</th>
                <th className="px-2 py-1 text-left font-medium">상품</th>
                <th className="px-2 py-1 text-right font-medium w-12">수량</th>
                <th className="px-2 py-1 text-left font-medium">배송메모</th>
              </tr>
            </thead>
            <tbody>
              {preview.map(r => (
                <tr key={r._key} className="border-t border-gray-100">
                  <td className="px-2 py-1 text-center text-gray-500">{r.seq}</td>
                  <td className="px-2 py-1 text-gray-800">{r.recipient_name ?? <span className="text-gray-400">(수령인 없음)</span>}</td>
                  <td className="px-2 py-1 text-gray-700">{r.phone ?? ''}</td>
                  <td className="px-2 py-1 text-gray-700">{[r.addr1, r.addr2].filter(Boolean).join(' ')}</td>
                  <td className="px-2 py-1 text-gray-800">
                    {r.item_name ?? <><span className={`${badge} bg-red-100 text-red-700 mr-1`}>미연결</span>{r.item_name_raw ?? ''}</>}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.quantity}</td>
                  <td className="px-2 py-1 text-gray-600">{r.memo ?? ''}</td>
                </tr>
              ))}
              {rows.length > 3 && (
                <tr className="border-t border-gray-100">
                  <td colSpan={7} className="px-2 py-1.5 text-center text-[0.65625rem] text-gray-400">
                    … 외 {rows.length - 3}행 — <button type="button" className="underline hover:text-gray-600" onClick={() => openPanel()}>명단 열기</button>에서 전체 확인 · 수정
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="mt-1.5 text-[0.6875rem] text-gray-400">
            요약 표는 읽기 전용 미리보기 3행. 빨간 배지나 &ldquo;확인 →&rdquo;를 누르면 그 문제 행만 걸러서 패널이 열립니다. 다시 업로드하면 기존 명단을 교체합니다.
          </div>
        </>
      )}

      {/* 명단 패널 (드로어) */}
      {open && roster && (
        <div className="fixed inset-0 z-50 flex justify-end" onMouseDown={e => { if (e.target === e.currentTarget) closePanel() }}>
          <div className="absolute inset-0 bg-slate-900/30" />
          <div className="relative h-full w-full md:w-[min(100vw-2rem,78rem)] bg-white shadow-2xl flex flex-col border-l-4 border-slate-900">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 flex-wrap">
              <div className="text-sm font-bold text-gray-900">
                배송명단{subject ? ` — ${subject}` : ''}
                <span className="text-[0.6875rem] font-normal text-gray-400 ml-2">{rows.length}행 · {summary?.recipient_count ?? 0}명</span>
              </div>
              <div className="ml-auto flex gap-1.5 flex-wrap">
                <button type="button" className={btn} onClick={() => download('excel')}>엑셀 다운로드</button>
                {!disabled && <button type="button" className={btn} onClick={addRow}>+ 행 추가</button>}
                {!disabled && <button type="button" className={`${btn} text-red-600`} onClick={removeRoster} disabled={busy}>명단 삭제</button>}
                {!disabled && <button type="button" className={btnDark} onClick={save} disabled={busy || !dirtyCount}>저장{dirtyCount ? ` (${dirtyCount})` : ''}</button>}
                <button type="button" className={btn} onClick={closePanel}>닫기</button>
              </div>
            </div>

            <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 flex items-center gap-1.5 flex-wrap text-xs">
              {([
                ['all', `전체 ${rows.length}`, 'bg-blue-100 text-blue-800'],
                ['unlinked', `품목 미연결 ${unlinkedRows}`, 'bg-red-100 text-red-700'],
                ['nophone', `연락처 없음 ${noPhoneRows}`, 'bg-amber-100 text-amber-800'],
                ['dirty', `수정됨 ${dirtyCount}`, 'bg-gray-200 text-gray-700'],
              ] as [Filter, string, string][]).map(([f, label, cls]) => (
                <button key={f} type="button" onClick={() => setFilter(f)}
                  className={`${badge} px-2 py-0.5 ${cls} ${filter === f ? 'ring-2 ring-slate-900' : 'opacity-80 hover:opacity-100'}`}>{label}</button>
              ))}
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="수령인 · 연락처 · 주소 · 상품 검색"
                className="ml-auto w-64 border border-gray-300 rounded-md px-2 py-1 text-xs bg-white" />
            </div>

            {applyHint && (
              <div className="px-4 py-1.5 bg-blue-50 border-b border-blue-100 text-xs text-blue-900 flex items-center gap-2 flex-wrap">
                같은 상품명 &ldquo;{applyHint.raw}&rdquo;의 미연결 {applyHint.count}행에도 <b>{applyHint.cand.item_name}</b>을(를) 연결할까요?
                <button type="button" className={btnBlue} onClick={applyAll}>모두 적용</button>
                <button type="button" className={btn} onClick={() => setApplyHint(null)}>아니오</button>
              </div>
            )}
            {notice && open && (
              <div className={`px-4 py-1.5 text-xs border-b ${notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'}`}>{notice.text}</div>
            )}

            <div className="flex-1 overflow-auto">
              <table className="w-full text-[0.71875rem] min-w-[72rem]">
                <thead className="sticky top-0 bg-gray-50 z-10">
                  <tr className="text-[0.65625rem] text-gray-500">
                    <th className="px-1.5 py-1.5 text-center font-medium w-10">NO</th>
                    <th className="px-1.5 py-1.5 text-left font-medium w-28">수령인</th>
                    <th className="px-1.5 py-1.5 text-left font-medium w-28">연락처</th>
                    <th className="px-1.5 py-1.5 text-left font-medium w-16">우편번호</th>
                    <th className="px-1.5 py-1.5 text-left font-medium">주소</th>
                    <th className="px-1.5 py-1.5 text-left font-medium w-36">상세주소</th>
                    <th className="px-1.5 py-1.5 text-left font-medium w-56">상품 (품목 연결)</th>
                    <th className="px-1.5 py-1.5 text-right font-medium w-14">수량</th>
                    <th className="px-1.5 py-1.5 text-left font-medium w-40">배송메모</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(r => {
                    const cell = `w-full border rounded-md px-1.5 py-1 text-[0.71875rem] disabled:opacity-60 ${
                      disabled ? 'border-gray-200 bg-gray-50' : 'border-amber-200 bg-amber-50/30'}`
                    const linked = !!r.item_name
                    return (
                      <tr key={r._key} className={`border-t border-gray-100 ${!linked ? 'bg-red-50/40' : r._dirty || r._new ? 'bg-blue-50/30' : ''}`}>
                        <td className="px-1.5 py-1 text-center text-gray-500">{r.seq}</td>
                        <td className="px-1.5 py-1"><input className={cell} disabled={disabled} value={r.recipient_name ?? ''} onChange={e => patch(r._key, { recipient_name: t(e.target.value) })} /></td>
                        <td className="px-1.5 py-1"><input className={cell} disabled={disabled} value={r.phone ?? ''} onChange={e => patch(r._key, { phone: t(e.target.value) })} placeholder="010-" /></td>
                        <td className="px-1.5 py-1"><input className={cell} disabled={disabled} value={r.zip ?? ''} onChange={e => patch(r._key, { zip: t(e.target.value) })} /></td>
                        <td className="px-1.5 py-1"><input className={cell} disabled={disabled} value={r.addr1 ?? ''} onChange={e => patch(r._key, { addr1: t(e.target.value) })} /></td>
                        <td className="px-1.5 py-1"><input className={cell} disabled={disabled} value={r.addr2 ?? ''} onChange={e => patch(r._key, { addr2: t(e.target.value) })} /></td>
                        <td className="px-1.5 py-1">
                          <div className="flex items-center gap-1">
                            {!linked && r.item_name_raw && <span className="text-red-700 truncate max-w-[7rem]" title={r.item_name_raw}>{r.item_name_raw} →</span>}
                            <select className={`${cell} ${!linked ? 'border-red-300 bg-red-50' : ''}`} disabled={disabled}
                              value={r.item_name ?? ''} onChange={e => pickItem(r, e.target.value)}>
                              <option value="">{linked ? '(연결 해제)' : '품목 선택'}</option>
                              {cands.map(c => <option key={c.item_name} value={c.item_name}>{c.item_name}{c.order_kind ? ` (${c.order_kind})` : ''}</option>)}
                            </select>
                          </div>
                        </td>
                        <td className="px-1.5 py-1"><input type="number" min={1} className={`${cell} text-right`} disabled={disabled} value={r.quantity}
                          onChange={e => patch(r._key, { quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })} /></td>
                        <td className="px-1.5 py-1"><input className={cell} disabled={disabled} value={r.memo ?? ''} onChange={e => patch(r._key, { memo: t(e.target.value) })} /></td>
                        <td className="px-1 py-1 text-center">
                          {!disabled && <button type="button" className="text-red-400 hover:text-red-600" title="행 삭제" onClick={() => removeRow(r)}>✕</button>}
                        </td>
                      </tr>
                    )
                  })}
                  {!pageRows.length && (
                    <tr><td colSpan={10} className="px-3 py-6 text-center text-xs text-gray-400">
                      {filter !== 'all' || search ? '조건에 맞는 행이 없습니다 — 필터를 끄거나 검색어를 지워보세요.' : '행이 없습니다.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-2 border-t border-gray-200 flex items-center gap-2 text-xs text-gray-500 flex-wrap">
              <span>{filter !== 'all' || search ? `필터 적용 중 — ${filtered.length}행` : `${rows.length}행`}</span>
              {pageCount > 1 && (
                <span className="ml-auto flex items-center gap-1.5">
                  <button type="button" className={btn} disabled={page === 0} onClick={() => setPage(p => p - 1)}>이전</button>
                  <span>{page * PAGE + 1}~{Math.min(filtered.length, (page + 1) * PAGE)} / {filtered.length}</span>
                  <button type="button" className={btn} disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)}>다음</button>
                </span>
              )}
              <span className={pageCount > 1 ? 'w-full text-[0.6875rem] text-gray-400' : 'ml-auto text-[0.6875rem] text-gray-400'}>
                수정은 패널의 저장 버튼으로 한 번에 반영됩니다(문서 저장과 별개). 우편번호는 확인 대상이 아니며 주소 앞에 붙이지 않습니다.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
