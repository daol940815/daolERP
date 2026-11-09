'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FIELDS, FIELD_BY_KEY, toSheetMap,
  type FormMapping, type SheetMap, type ValueSpec, type RecognizeResult, type RecognizedSheet, type How,
} from '@/lib/po-vendor-form-fields'

// 매입처 상세 › 발주서 양식 탭 (516, 2026-11-09 — 시안 '업체 발주서 양식 등록' 확정)
// 업체 엑셀을 올리면 자동 인식 → 직원이 칸 연결을 고침 → 시험 생성 → 사용 시작. 등록 · 수정 = 매입처 관리 수정 권한(can_edit).
// 버전은 쌓인다(작성 중 → 사용 중 → 보관). 사용 중 · 보관 버전은 고치지 않고 '복사해 새 버전'.

interface FormRow {
  id: string; version: number; file_name: string; status: 'draft' | 'active' | 'archived'
  mapping: FormMapping; recognized: RecognizeResult | null; memo: string | null
  uploaded_at: string; activated_at: string | null; uploader_name: string | null; activator_name: string | null
}
interface RecentPo { id: string; po_no: string; created_at: string; total_amount: number }

const STATUS: Record<FormRow['status'], { label: string; cls: string }> = {
  draft: { label: '작성 중', cls: 'bg-amber-100 text-amber-700' },
  active: { label: '사용 중', cls: 'bg-green-100 text-green-700' },
  archived: { label: '보관', cls: 'bg-gray-100 text-gray-500' },
}
const MODE_LABEL: Record<SheetMap['mode'], string> = { rows: '명단형', catalog: '품목 목록형', 'cells-only': '머리 칸만' }
const HOW: Record<How | 'edited', { label: string; cls: string }> = {
  auto: { label: '자동', cls: 'bg-sky-50 text-sky-700' },
  check: { label: '확인 필요', cls: 'bg-amber-100 text-amber-700' },
  none: { label: '모름', cls: 'bg-red-50 text-red-600' },
  edited: { label: '수정함', cls: 'bg-green-50 text-green-700' },
}
const day = (s: string | null) => (s ? s.slice(5, 10).replace('-', '/') : '-')
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const INSERT_KEYS = ['item_name', 'item_memo', 'qty', 'r_name', 'customer', 'manager', 'staff', 'staff_title', 'po_no', 'line_no']

// 넣을 값 고르기 — 값 목록 · 양식 값 유지 · 비움 · 건드리지 않음 · 고정/조합 문구
function ValuePicker({ spec, onChange, disabled }: { spec: ValueSpec | undefined; onChange: (s: ValueSpec) => void; disabled?: boolean }) {
  const one = spec?.k === 'tpl' ? spec.v.match(/^\{([a-z_0-9]+)\}$/) : null
  const sel = !spec || spec.k === 'skip' ? 'skip' : spec.k === 'keep' ? 'keep' : spec.k === 'blank' ? 'blank'
    : one && FIELD_BY_KEY.has(one[1]) ? `f:${one[1]}` : 'tpl'
  const groups = Array.from(new Set(FIELDS.map(f => f.group)))
  const preview = spec?.k === 'tpl' && sel === 'tpl'
    ? spec.v.replace(/\{([a-z_0-9]+)\}/g, (raw, k: string) => FIELD_BY_KEY.get(k)?.example ?? raw) : null
  return (
    <div className="space-y-1">
      <select value={sel} disabled={disabled}
        onChange={e => {
          const v = e.target.value
          if (v.startsWith('f:')) onChange({ k: 'tpl', v: `{${v.slice(2)}}` })
          else if (v === 'tpl') onChange({ k: 'tpl', v: spec?.k === 'tpl' ? spec.v : '' })
          else onChange({ k: v as 'keep' | 'blank' | 'skip' })
        }}
        className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white disabled:bg-gray-50">
        {groups.map(g => (
          <optgroup key={g} label={g}>
            {FIELDS.filter(f => f.group === g).map(f => <option key={f.key} value={`f:${f.key}`}>{f.label}</option>)}
          </optgroup>
        ))}
        <optgroup label="기타">
          <option value="tpl">고정 문구 · 조합 문구…</option>
          <option value="keep">양식 값 유지</option>
          <option value="blank">비움</option>
          <option value="skip">건드리지 않음</option>
        </optgroup>
      </select>
      {sel === 'tpl' && spec?.k === 'tpl' && (
        <div className="space-y-1">
          <input value={spec.v} disabled={disabled} onChange={e => onChange({ k: 'tpl', v: e.target.value })}
            placeholder="예: {item_name} ({qty}개) · 다올커머스"
            className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono disabled:bg-gray-50" />
          {!disabled && (
            <div className="flex flex-wrap gap-1">
              {INSERT_KEYS.map(k => (
                <button key={k} type="button" onClick={() => onChange({ k: 'tpl', v: `${spec.v}{${k}}` })}
                  className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[0.6875rem] hover:bg-slate-200">
                  + {FIELD_BY_KEY.get(k)?.label}
                </button>
              ))}
            </div>
          )}
          {preview && <div className="text-[0.6875rem] text-gray-500">미리보기: {preview}</div>}
        </div>
      )}
    </div>
  )
}

export default function PoFormTab({ vendorId, vendorName }: { vendorId: string; vendorName: string }) {
  const [forms, setForms] = useState<FormRow[]>([])
  const [recentPos, setRecentPos] = useState<RecentPo[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [mapping, setMapping] = useState<FormMapping | null>(null)
  const [memo, setMemo] = useState('')
  const [dirty, setDirty] = useState(false)
  const [edited, setEdited] = useState<Set<string>>(new Set())
  const [testPo, setTestPo] = useState('sample')
  const [testWarnings, setTestWarnings] = useState<string[] | null>(null)
  const [newCol, setNewCol] = useState('')
  const [newCell, setNewCell] = useState('')
  const [pendingOpen, setPendingOpen] = useState<string | null>(null)   // 올린 직후 새 버전 열기

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/purchase-hub/${vendorId}/po-forms`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? '불러오지 못했습니다.')
      setForms(j.forms ?? []); setRecentPos(j.recent_pos ?? []); setCanEdit(!!j.can_edit); setHint(j.hint ?? null)
    } catch (e) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : '불러오지 못했습니다.' })
    } finally { setLoading(false) }
  }, [vendorId])
  useEffect(() => { load() }, [load])

  const open = forms.find(f => f.id === openId) ?? null
  const editable = !!open && open.status === 'draft' && canEdit
  const sm = mapping?.sheets[0] ?? null
  const rs: RecognizedSheet | null = open?.recognized?.sheets.find(s => s.name === sm?.name) ?? null

  const openForm = (f: FormRow, force = false) => {
    if (!force && dirty && !confirm('저장하지 않은 칸 연결이 있습니다. 버리고 다른 버전을 열까요?')) return
    setOpenId(f.id); setMapping(clone(f.mapping?.sheets ? f.mapping : { version: 1, sheets: [] }))
    setMemo(f.memo ?? ''); setDirty(false); setEdited(new Set()); setTestWarnings(null)
  }
  const patchSheet = (fn: (s: SheetMap) => void) => {
    if (!mapping || !sm) return
    const next = clone(mapping); fn(next.sheets[0]); setMapping(next); setDirty(true)
  }
  const setCol = (col: string, spec: ValueSpec) => {
    patchSheet(s => { if (spec.k === 'skip') delete s.columns[col]; else s.columns[col] = spec })
    setEdited(prev => new Set(prev).add(`c:${col}`))
  }
  const setCellSpec = (addr: string, spec: ValueSpec | null) => {
    patchSheet(s => { s.cells = s.cells ?? {}; if (!spec) delete s.cells[addr]; else s.cells[addr] = spec })
    setEdited(prev => new Set(prev).add(`a:${addr}`))
  }

  const call = async (init: RequestInit & { url?: string }, okText: string) => {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(init.url ?? `/api/purchase-hub/${vendorId}/po-forms`, init)
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? '처리하지 못했습니다.')
      setMsg({ tone: 'ok', text: okText }); await load()
      return j as { id?: string }
    } catch (e) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : '처리하지 못했습니다.' }); return null
    } finally { setBusy(false) }
  }
  const patch = (body: Record<string, unknown>, okText: string) =>
    call({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, okText)

  const upload = async (file: File) => {
    const fd = new FormData(); fd.append('file', file)
    const j = await call({ method: 'POST', body: fd }, `'${file.name}'을 올리고 자동 인식했습니다 — 칸 연결을 확인하세요.`)
    if (j?.id) setPendingOpen(j.id)
  }
  useEffect(() => {
    if (!pendingOpen) return
    const f = forms.find(x => x.id === pendingOpen)
    if (f) { setPendingOpen(null); openForm(f, true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forms, pendingOpen])

  const save = async () => {
    if (!open || !mapping) return false
    const ok = await patch({ action: 'save', form_id: open.id, mapping, memo }, '칸 연결을 저장했습니다.')
    if (ok) setDirty(false)
    return !!ok
  }
  const runTest = async () => {
    if (!open) return
    if (dirty && editable && !(await save())) return
    setBusy(true); setMsg(null); setTestWarnings(null)
    try {
      const res = await fetch(`/api/purchase-hub/${vendorId}/po-forms/${open.id}/test?po=${encodeURIComponent(testPo)}`)
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? '시험 생성에 실패했습니다.') }
      const w = res.headers.get('X-Po-Warnings')
      setTestWarnings(w ? JSON.parse(decodeURIComponent(w)) : [])
      const cd = res.headers.get('Content-Disposition') ?? ''
      const name = decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? `${vendorName}_양식시험.xlsx`)
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a'); a.href = url; a.download = name; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      setMsg({ tone: 'ok', text: '시험 파일을 만들었습니다 — 엑셀에서 열어 칸을 확인하세요.' })
    } catch (e) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : '시험 생성에 실패했습니다.' })
    } finally { setBusy(false) }
  }
  const activate = async () => {
    if (!open) return
    if (dirty && !(await save())) return
    const cur = forms.find(f => f.status === 'active')
    if (!confirm(`버전 ${open.version}을 사용 시작할까요?${cur ? ` 지금 사용 중인 버전 ${cur.version}은 보관으로 바뀝니다.` : ''}`)) return
    await patch({ action: 'activate', form_id: open.id }, `버전 ${open.version} 사용을 시작했습니다.`)
  }
  const changeSheet = (name: string) => {
    const target = open?.recognized?.sheets.find(s => s.name === name)
    if (!target || !mapping) return
    if (!confirm(`'${name}' 시트로 바꾸면 칸 연결을 그 시트의 자동 인식 결과로 다시 채웁니다. 계속할까요?`)) return
    setMapping({ version: 1, sheets: [toSheetMap(target)] }); setDirty(true); setEdited(new Set())
  }

  // 열 목록 = 인식된 머리글 + 직접 추가한 열
  const colRows = useMemo(() => {
    if (!sm) return []
    const rows = (rs?.columns ?? []).map(c => ({ col: c.col, header: c.header, how: c.how as How, reason: c.reason }))
    for (const col of Object.keys(sm.columns)) if (!rows.some(r => r.col === col)) rows.push({ col, header: '(직접 추가)', how: 'auto', reason: '' })
    const n = (c: string) => c.length * 1000 + c.charCodeAt(c.length - 1) + (c.length > 1 ? c.charCodeAt(0) * 30 : 0)
    return rows.sort((a, b) => n(a.col) - n(b.col))
  }, [sm, rs])
  const cellRows = useMemo(() => {
    if (!sm) return []
    const known = new Map((rs?.cells ?? []).map(c => [c.addr, c]))
    return Object.keys(sm.cells ?? {}).map(addr => ({ addr, label: known.get(addr)?.label ?? '(직접 추가)', how: (known.get(addr)?.how ?? 'auto') as How, reason: known.get(addr)?.reason ?? '' }))
  }, [sm, rs])
  const counts = useMemo(() => {
    const c = { auto: 0, check: 0, none: 0, edited: 0 }
    for (const r of colRows) { if (edited.has(`c:${r.col}`)) c.edited++; else c[r.how]++ }
    for (const r of cellRows) { if (edited.has(`a:${r.addr}`)) c.edited++; else c[r.how]++ }
    return c
  }, [colRows, cellRows, edited])

  const numInput = (v: number | null | undefined, onChange: (n: number | null) => void, ph = '') => (
    <input type="number" min={1} value={v ?? ''} placeholder={ph} disabled={!editable}
      onChange={e => onChange(e.target.value === '' ? null : Math.max(1, Math.floor(Number(e.target.value))))}
      className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-right tabular-nums disabled:bg-gray-50" />
  )

  if (loading && !forms.length) return <div className="text-sm text-gray-400 py-6">불러오는 중…</div>

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-gray-800">{vendorName} · 발주서 양식</div>
            <p className="text-xs text-gray-500 mt-1 max-w-2xl">
              업체가 쓰는 발주서 엑셀(.xlsx)을 올리면 머리글을 읽어 칸마다 넣을 값을 추천합니다. &lsquo;확인 필요&rsquo; 칸만 고르고 시험 생성으로 확인한 뒤
              사용 시작을 누르세요. 새 버전은 사용 시작 전까지 적용되지 않습니다.
            </p>
            <p className="text-xs text-amber-700 mt-1">
              지금은 등록 · 시험 생성 단계입니다. 발주서 다운로드 · 메일 첨부가 사용 중 양식으로 바뀌는 것은 다음 배포(2차)부터입니다.
            </p>
          </div>
          {canEdit && !hint && (
            <label className={`px-3.5 py-1.5 rounded-lg text-sm cursor-pointer ${busy ? 'bg-gray-300 text-white' : 'bg-slate-900 text-white hover:bg-slate-700'}`}>
              새 양식 올리기 (.xlsx)
              <input type="file" accept=".xlsx,.xlsm,.xls" className="hidden" disabled={busy}
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f) }} />
            </label>
          )}
        </div>
        {hint && <div className="mt-3 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{hint}</div>}
        {msg && <div className={`mt-3 text-sm rounded-lg px-3 py-2 ${msg.tone === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>{msg.text}</div>}

        {forms.length > 0 ? (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-200">
                  <th className="text-left py-1.5 px-2 font-medium">버전</th>
                  <th className="text-left py-1.5 px-2 font-medium">파일</th>
                  <th className="text-left py-1.5 px-2 font-medium">올린 날 · 사람</th>
                  <th className="text-left py-1.5 px-2 font-medium">형태</th>
                  <th className="text-left py-1.5 px-2 font-medium">상태</th>
                  <th className="text-right py-1.5 px-2 font-medium">작업</th>
                </tr>
              </thead>
              <tbody>
                {forms.map(f => {
                  const s0 = f.mapping?.sheets?.[0]
                  return (
                    <tr key={f.id} className={`border-b border-gray-100 last:border-0 ${f.id === openId ? 'bg-slate-50' : ''}`}>
                      <td className="py-1.5 px-2 tabular-nums font-semibold">{f.version}</td>
                      <td className="py-1.5 px-2">
                        <a href={`/api/purchase-hub/${vendorId}/po-forms?download=${f.id}`} className="text-blue-600 hover:underline">{f.file_name}</a>
                        {f.memo && <div className="text-xs text-gray-400">{f.memo}</div>}
                      </td>
                      <td className="py-1.5 px-2 text-xs text-gray-500 tabular-nums">
                        {day(f.uploaded_at)} · {f.uploader_name ?? '-'}
                        {f.activated_at && <div>사용 시작 {day(f.activated_at)} · {f.activator_name ?? '-'}</div>}
                      </td>
                      <td className="py-1.5 px-2 text-xs text-gray-600">
                        {s0 ? `${MODE_LABEL[s0.mode]} · '${s0.name}' ${s0.header_row ? `${s0.header_row}행 머리글` : ''}` : '칸 연결 없음'}
                      </td>
                      <td className="py-1.5 px-2"><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS[f.status].cls}`}>{STATUS[f.status].label}</span></td>
                      <td className="py-1.5 px-2 text-right whitespace-nowrap space-x-1.5">
                        <button onClick={() => openForm(f)} className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50">
                          {f.status === 'draft' && canEdit ? '칸 연결' : '보기 · 시험'}
                        </button>
                        {canEdit && f.status !== 'draft' && (
                          <button disabled={busy} onClick={() => patch({ action: 'copy', form_id: f.id }, `버전 ${f.version}을 복사해 새 버전을 만들었습니다.`)}
                            className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50">복사해 새 버전</button>
                        )}
                        {canEdit && f.status === 'active' && (
                          <button disabled={busy} onClick={() => confirm('이 양식 사용을 멈출까요? 그 뒤로는 자사 발주서 양식으로 나갑니다.') && patch({ action: 'archive', form_id: f.id }, '사용을 멈췄습니다.')}
                            className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-500 hover:bg-gray-50">사용 멈춤</button>
                        )}
                        {canEdit && f.status === 'draft' && (
                          <button disabled={busy} onClick={async () => {
                            if (!confirm(`작성 중인 버전 ${f.version}을 지울까요?`)) return
                            if (await call({ method: 'DELETE', url: `/api/purchase-hub/${vendorId}/po-forms?form_id=${f.id}` }, '지웠습니다.')) {
                              if (openId === f.id) { setOpenId(null); setMapping(null); setDirty(false) }
                            }
                          }} className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50">삭제</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : !hint && (
          <div className="mt-3 text-sm text-gray-400">등록된 양식이 없습니다 — 이 매입처 발주서는 자사 양식으로 나갑니다.</div>
        )}
      </div>

      {open && mapping && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-bold text-gray-800">
              버전 {open.version} · {open.file_name}
              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-normal ${STATUS[open.status].cls}`}>{STATUS[open.status].label}</span>
              {dirty && <span className="ml-2 text-xs text-amber-700 font-normal">저장 안 됨</span>}
            </div>
            <button onClick={() => { if (!dirty || confirm('저장하지 않은 변경을 버릴까요?')) { setOpenId(null); setMapping(null); setDirty(false) } }}
              className="text-xs text-gray-500 hover:text-gray-700">닫기</button>
          </div>
          {!editable && (
            <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              {open.status === 'draft' ? '보기 전용입니다(매입처 관리 수정 권한 필요).' : '사용 중 · 보관 버전은 고칠 수 없습니다 — 바꾸려면 목록에서 [복사해 새 버전].'}
            </div>
          )}
          {(open.recognized?.notes?.length || rs?.notes?.length) ? (
            <ul className="text-xs text-gray-600 list-disc pl-5 space-y-0.5">
              {[...(open.recognized?.notes ?? []), ...(rs?.notes ?? [])].map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          ) : null}

          {!sm ? (
            <div className="text-sm text-gray-500">채울 시트를 고르세요.
              <select disabled={!editable} onChange={e => changeSheet(e.target.value)} defaultValue="" className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm">
                <option value="" disabled>시트 선택</option>
                {open.recognized?.sheets.map(s => <option key={s.name} value={s.name}>{s.name}{s.state !== 'visible' ? ' (숨김)' : ''}</option>)}
              </select>
            </div>
          ) : (
            <>
              {/* 시트 · 행 설정 */}
              <div className="grid md:grid-cols-2 gap-3">
                <div className="border border-gray-200 rounded-lg p-3 space-y-2 text-sm">
                  <div className="font-semibold text-gray-700 text-xs">시트 · 형태</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-gray-500 text-xs w-16">채울 시트</span>
                    <select value={sm.name} disabled={!editable} onChange={e => changeSheet(e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-50">
                      {open.recognized?.sheets.map(s => <option key={s.name} value={s.name}>{s.name}{s.state !== 'visible' ? ' (숨김)' : ''}</option>)}
                    </select>
                    <span className="text-xs text-gray-400">다른 시트는 그대로 둡니다</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-gray-500 text-xs w-16">채우는 방식</span>
                    {(['rows', 'catalog', 'cells-only'] as const).map(m => (
                      <label key={m} className="flex items-center gap-1 text-sm">
                        <input type="radio" checked={sm.mode === m} disabled={!editable}
                          onChange={() => patchSheet(s => {
                            s.mode = m
                            if (m === 'catalog' && !s.catalog) s.catalog = { name_col: 'C', qty_col: 'D', start_row: s.start_row, end_row: s.end_row ?? s.start_row + 10 }
                          })} />
                        {MODE_LABEL[m]}
                      </label>
                    ))}
                  </div>
                  <div className="text-xs text-gray-400">
                    명단형 = 1행에 1품목(개별 배송 명단이 있으면 수령인 1명당 1행) · 품목 목록형 = 인쇄된 품목 행에 수량만 · 머리 칸만 = 표 없이 칸 몇 개
                  </div>
                </div>
                {sm.mode === 'rows' && (
                  <div className="border border-gray-200 rounded-lg p-3 space-y-2 text-sm">
                    <div className="font-semibold text-gray-700 text-xs">행 설정</div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <label className="flex items-center gap-1.5 text-xs text-gray-500">머리글 {numInput(sm.header_row, n => patchSheet(s => { s.header_row = n }))}행</label>
                      <label className="flex items-center gap-1.5 text-xs text-gray-500">첫 품목 {numInput(sm.start_row, n => patchSheet(s => { s.start_row = n ?? 1 }))}행</label>
                      <label className="flex items-center gap-1.5 text-xs text-gray-500">준비된 마지막 {numInput(sm.end_row, n => patchSheet(s => { s.end_row = n }), '제한 없음')}행</label>
                      <label className="flex items-center gap-1.5 text-xs text-gray-500">안내 · 합계 시작 {numInput(sm.insert_before, n => patchSheet(s => { s.insert_before = n }), '없음')}행</label>
                    </div>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={!!sm.clear_examples} disabled={!editable} onChange={e => patchSheet(s => { s.clear_examples = e.target.checked })} />
                      예시 행 지우고 그 자리부터 채우기
                    </label>
                    <div className="text-xs text-gray-400">행이 모자라면 마지막 행 서식 · 수식을 복사해 늘리고, 안내 · 합계 영역이 있으면 그 앞에 끼워 넣습니다.</div>
                  </div>
                )}
                {sm.mode === 'catalog' && sm.catalog && (
                  <div className="border border-gray-200 rounded-lg p-3 space-y-2 text-sm">
                    <div className="font-semibold text-gray-700 text-xs">품목 목록</div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
                      <label className="flex items-center gap-1.5">품명 열
                        <input value={sm.catalog.name_col} disabled={!editable} onChange={e => patchSheet(s => { s.catalog!.name_col = e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })}
                          className="w-14 border border-gray-300 rounded px-2 py-1 text-sm uppercase disabled:bg-gray-50" /></label>
                      <label className="flex items-center gap-1.5">수량 열
                        <input value={sm.catalog.qty_col} disabled={!editable} onChange={e => patchSheet(s => { s.catalog!.qty_col = e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })}
                          className="w-14 border border-gray-300 rounded px-2 py-1 text-sm uppercase disabled:bg-gray-50" /></label>
                      <label className="flex items-center gap-1.5">{numInput(sm.catalog.start_row, n => patchSheet(s => { s.catalog!.start_row = n ?? 1 }))}행 ~ {numInput(sm.catalog.end_row, n => patchSheet(s => { s.catalog!.end_row = n ?? s.catalog!.start_row }))}행</label>
                    </div>
                    <div className="text-xs text-gray-400">같은 품명(띄어쓰기 무시) 행의 수량 칸에만 넣습니다. 목록에 없는 품목은 확인 목록에 경고로 남습니다.</div>
                  </div>
                )}
              </div>

              {/* 상태 요약 */}
              <div className="flex flex-wrap gap-1.5 text-xs">
                {(['auto', 'check', 'none', 'edited'] as const).filter(k => counts[k]).map(k => (
                  <span key={k} className={`px-2 py-0.5 rounded-full ${HOW[k].cls}`}>{HOW[k].label} {counts[k]}</span>
                ))}
              </div>

              {/* 열 연결 */}
              {sm.mode === 'rows' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[760px]">
                    <thead>
                      <tr className="text-xs text-gray-500 border-b border-gray-200">
                        <th className="text-left py-1.5 px-2 font-medium w-12">열</th>
                        <th className="text-left py-1.5 px-2 font-medium w-48">머리글</th>
                        <th className="text-left py-1.5 px-2 font-medium">넣을 값</th>
                        <th className="text-center py-1.5 px-2 font-medium w-12">필수</th>
                        <th className="text-left py-1.5 px-2 font-medium w-64">추천 근거</th>
                      </tr>
                    </thead>
                    <tbody>
                      {colRows.map(r => {
                        const how = edited.has(`c:${r.col}`) ? 'edited' : r.how
                        return (
                          <tr key={r.col} className={`border-b border-gray-100 align-top ${how === 'check' || how === 'none' ? 'bg-amber-50/40' : ''}`}>
                            <td className="py-1.5 px-2 font-mono text-xs text-gray-500">{r.col}</td>
                            <td className="py-1.5 px-2 text-sm">{r.header}</td>
                            <td className="py-1.5 px-2"><ValuePicker spec={sm.columns[r.col]} disabled={!editable} onChange={s => setCol(r.col, s)} /></td>
                            <td className="py-1.5 px-2 text-center">
                              <input type="checkbox" disabled={!editable} checked={(sm.required ?? []).includes(r.col)}
                                onChange={e => patchSheet(s => { const set = new Set(s.required ?? []); if (e.target.checked) set.add(r.col); else set.delete(r.col); s.required = Array.from(set) })} />
                            </td>
                            <td className="py-1.5 px-2 text-xs text-gray-500">
                              <span className={`px-1.5 py-0.5 rounded mr-1 ${HOW[how].cls}`}>{HOW[how].label}</span>{r.reason}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {editable && (
                    <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                      열 추가
                      <input value={newCol} onChange={e => setNewCol(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))} placeholder="예: T"
                        className="w-16 border border-gray-300 rounded px-2 py-1 text-sm uppercase" />
                      <button disabled={!newCol} onClick={() => { setCol(newCol, { k: 'tpl', v: '' }); setNewCol('') }}
                        className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40">추가</button>
                    </div>
                  )}
                </div>
              )}

              {/* 머리 칸 */}
              <div>
                <div className="text-xs font-semibold text-gray-700 mb-1">머리 칸 <span className="font-normal text-gray-400">표 바깥의 칸 하나하나(발주처 정보 · 납품처 · 배송메모 등)</span></div>
                {cellRows.length > 0 ? (
                  <table className="w-full text-sm max-w-3xl">
                    <tbody>
                      {cellRows.map(r => {
                        const how = edited.has(`a:${r.addr}`) ? 'edited' : r.how
                        return (
                          <tr key={r.addr} className="border-b border-gray-100 align-top">
                            <td className="py-1.5 px-2 font-mono text-xs text-gray-500 w-14">{r.addr}</td>
                            <td className="py-1.5 px-2 text-sm w-44">{r.label}</td>
                            <td className="py-1.5 px-2"><ValuePicker spec={sm.cells?.[r.addr]} disabled={!editable} onChange={s => setCellSpec(r.addr, s)} /></td>
                            <td className="py-1.5 px-2 text-xs text-gray-500 w-56"><span className={`px-1.5 py-0.5 rounded mr-1 ${HOW[how].cls}`}>{HOW[how].label}</span>{r.reason}</td>
                            <td className="py-1.5 px-2 w-10">{editable && <button onClick={() => setCellSpec(r.addr, null)} className="text-xs text-red-500 hover:underline">빼기</button>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : <div className="text-xs text-gray-400">없음</div>}
                {editable && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                    칸 추가
                    <input value={newCell} onChange={e => setNewCell(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} placeholder="예: C27"
                      className="w-20 border border-gray-300 rounded px-2 py-1 text-sm uppercase" />
                    <button disabled={!/^[A-Z]{1,3}[1-9]\d*$/.test(newCell)} onClick={() => { setCellSpec(newCell, { k: 'tpl', v: '' }); setNewCell('') }}
                      className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40">추가</button>
                  </div>
                )}
              </div>

              <label className="block text-xs text-gray-500">메모
                <input value={memo} disabled={!editable} onChange={e => { setMemo(e.target.value); setDirty(true) }} placeholder="예: 2026년 11월 양식"
                  className="mt-1 w-full max-w-md border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-50" />
              </label>
            </>
          )}

          {/* 저장 · 시험 생성 · 사용 시작 */}
          <div className="border-t border-gray-200 pt-3 flex flex-wrap items-center gap-2">
            {editable && (
              <button disabled={busy || !dirty} onClick={save} className="px-3.5 py-1.5 rounded-lg text-sm bg-slate-900 text-white disabled:bg-gray-300">저장</button>
            )}
            <span className="text-xs text-gray-500 ml-2">시험 생성</span>
            <select value={testPo} onChange={e => setTestPo(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm max-w-xs">
              <option value="sample">가상 주문(수령인 3명 포함)</option>
              {recentPos.map(p => <option key={p.id} value={p.id}>{p.po_no} · {day(p.created_at)} · {p.total_amount.toLocaleString('ko-KR')}원</option>)}
            </select>
            <button disabled={busy || !sm} onClick={runTest} className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 hover:bg-gray-50 disabled:opacity-40">
              {dirty && editable ? '저장하고 만들기' : '만들어 받기'}
            </button>
            {canEdit && open.status === 'draft' && (
              <button disabled={busy || !sm} onClick={activate} className="ml-auto px-3.5 py-1.5 rounded-lg text-sm bg-green-700 text-white hover:bg-green-800 disabled:bg-gray-300">
                사용 시작 (버전 {open.version})
              </button>
            )}
          </div>
          {testWarnings && (
            <div className={`text-sm rounded-lg px-3 py-2 ${testWarnings.length ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700'}`}>
              {testWarnings.length ? (
                <>
                  <div className="font-semibold text-xs mb-1">확인 목록 {testWarnings.length}</div>
                  <ul className="list-disc pl-5 space-y-0.5 text-xs">{testWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </>
              ) : '확인할 것 없음 — 받은 파일을 열어 칸 위치만 확인하세요.'}
            </div>
          )}
          <div className="text-xs text-gray-400">
            값 목록에 없는 문구는 &lsquo;고정 문구 · 조합 문구&rsquo;로 — 예: {'{item_name} ({qty}개)'} → 가상 선물세트 (3개), 다올커머스 → 그대로.
            수식 칸은 넣을 값을 골라도 원본 수식을 지킵니다.
          </div>
        </div>
      )}
    </div>
  )
}
