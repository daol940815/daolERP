'use client'

// 업무 요청 태그 관리 — 마스터 계정 전용 (904, 2026-11-10 사용자 결정: 관리자 태그 추가 도입).
//  규칙: 추가 · 수정은 마스터만 / 삭제 없음, 숨김만(과거 요청 · 통계 보존) / 이름을 바꾸면 과거 요청도 새 이름으로 보임 /
//        사용 중 태그 최대 12개 / 비슷한 태그가 있으면 추가 전에 경고 / 색은 정해진 10색.
//  차단은 API(/api/work-requests/tags)가 한다 — 이 화면은 마스터가 아니면 안내만 보여준다.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { WR_TAG_COLORS, tagDotCls, type WrTag } from '@/lib/work-requests'
import { TagChip } from '@/components/work-requests/tag-chip'

interface Resp { tags: WrTag[]; ready: boolean; can_manage: boolean; active_max: number; usage?: Record<string, number>; error?: string }
const splitKw = (v: string) => Array.from(new Set(v.split(',').map(x => x.trim()).filter(Boolean)))

// 이름 · 키워드가 겹치는 기존 태그 (난립 방지 경고용)
function similarTags(label: string, keywords: string[], tags: WrTag[], selfId?: string): { tag: WrTag; why: string }[] {
  const l = label.trim().toLowerCase()
  if (!l && !keywords.length) return []
  const out: { tag: WrTag; why: string }[] = []
  for (const t of tags) {
    if (t.id === selfId) continue
    const tl = t.label.toLowerCase()
    const parts = tl.split(/[·\s,/]+/).filter(Boolean)
    const kw = t.keywords.map(k => k.toLowerCase())
    const hit = keywords.map(k => k.toLowerCase()).find(k => kw.includes(k) || parts.includes(k))
    if (l && (tl === l || (l.length >= 2 && (tl.includes(l) || parts.some(p => p.length >= 2 && l.includes(p)))))) out.push({ tag: t, why: '이름이 비슷함' })
    else if (l && kw.some(k => k.length >= 2 && l.includes(k))) out.push({ tag: t, why: `키워드 "${kw.find(k => k.length >= 2 && l.includes(k))}" 겹침` })
    else if (hit) out.push({ tag: t, why: `키워드 "${hit}" 겹침` })
  }
  return out
}

export default function TagManagePage() {
  const [data, setData] = useState<Resp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ label: '', keywords: '', color: 'pink' })
  const [edit, setEdit] = useState<{ id: string; label: string; keywords: string; color: string } | null>(null)
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    const res = await fetch('/api/work-requests/tags?usage=1', { cache: 'no-store' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(json.error ?? '조회 실패'); return }
    setData(json); setErr(null)
  }, [])
  useEffect(() => { load() }, [load])

  const send = async (method: 'POST' | 'PATCH', body: Record<string, unknown>) => {
    setBusy(true)
    const res = await fetch('/api/work-requests/tags', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(json.error ?? '처리 실패'); return false }
    await load()
    return true
  }

  const tags = useMemo(() => data?.tags ?? [], [data])
  const active = tags.filter(t => t.active), hidden = tags.filter(t => !t.active)
  const similarNew = useMemo(() => similarTags(form.label, splitKw(form.keywords), tags), [form, tags])
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.label.trim()) { flash('태그 이름을 입력하세요.'); return }
    if (similarNew.length && !window.confirm(`비슷한 태그가 있습니다: ${similarNew.map(x => `${x.tag.label}(${x.why})`).join(', ')}\n같은 뜻이면 통계가 갈라집니다. 그래도 추가할까요?`)) return
    if (await send('POST', { label: form.label.trim(), keywords: splitKw(form.keywords), color: form.color })) setForm({ label: '', keywords: '', color: 'pink' })
  }
  const saveEdit = async () => {
    if (!edit) return
    if (await send('PATCH', { id: edit.id, label: edit.label.trim(), keywords: splitKw(edit.keywords), color: edit.color })) setEdit(null)
  }
  const hide = (t: WrTag) => { if (window.confirm(`'${t.label}' 태그를 숨길까요?\n새 요청에서는 고를 수 없게 되고, 과거 요청과 통계에는 그대로 남습니다.`)) send('PATCH', { id: t.id, active: false }) }

  const back = <Link href="/me/requests" className="text-sm text-gray-500 hover:text-gray-900">← 업무 요청</Link>
  if (err) return <div className="max-w-5xl mx-auto">{back}<div className="mt-3 px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">{err}</div></div>
  if (!data) return <div className="text-center py-20 text-gray-400">로딩 중...</div>
  if (!data.ready) return <div className="max-w-5xl mx-auto">{back}<div className="mt-3 px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">904 마이그레이션(업무 요청 태그)이 아직 적용되지 않았습니다. SQL 편집기에서 904_work_request_tags.sql을 실행해주세요.</div></div>
  if (!data.can_manage) return <div className="max-w-5xl mx-auto">{back}<div className="mt-3 px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">태그 관리는 마스터 계정만 할 수 있습니다. 필요한 태그가 있으면 ERP 총괄 담당자에게 업무 요청으로 알려 주세요.</div></div>

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900'
  const colorSelect = (value: string, onChange: (v: string) => void) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-full ${tagDotCls(value)}`} />
      <select value={value} onChange={e => onChange(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
        {WR_TAG_COLORS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
    </span>
  )
  const row = (t: WrTag, i: number, list: WrTag[]) => {
    const editing = edit?.id === t.id
    return (
      <tr key={t.id} className={`border-b border-gray-100 ${t.active ? '' : 'opacity-60'}`}>
        <td className="py-2 px-3 whitespace-nowrap text-xs text-gray-500">
          {t.active ? (
            <>
              <span className="tabular-nums mr-1.5">{i + 1}</span>
              <button disabled={busy || i === 0} onClick={() => send('PATCH', { id: t.id, move: 'up' })} className="px-1 text-gray-500 hover:text-gray-900 disabled:opacity-30" title="위로">▲</button>
              <button disabled={busy || i === list.length - 1} onClick={() => send('PATCH', { id: t.id, move: 'down' })} className="px-1 text-gray-500 hover:text-gray-900 disabled:opacity-30" title="아래로">▼</button>
            </>
          ) : '—'}
        </td>
        <td className="py-2 px-3">
          {editing ? <input value={edit.label} onChange={e => setEdit({ ...edit, label: e.target.value })} maxLength={20} className={inputCls} /> : <TagChip tag={t} size="md" />}
        </td>
        <td className="py-2 px-3 text-xs text-gray-600">
          {editing ? <input value={edit.keywords} onChange={e => setEdit({ ...edit, keywords: e.target.value })} placeholder="쉼표로 구분" className={inputCls} /> : (t.keywords.length ? t.keywords.join(', ') : <span className="text-gray-400">없음 — 추천하지 않음</span>)}
        </td>
        <td className="py-2 px-3 whitespace-nowrap">{editing ? colorSelect(edit.color, v => setEdit({ ...edit, color: v })) : <span className="text-xs text-gray-500">{WR_TAG_COLORS.find(c => c.key === t.color)?.label ?? t.color}</span>}</td>
        <td className="py-2 px-3 text-right tabular-nums">
          <Link href={`/me/requests?tab=all&tag=${t.id}`} className="text-gray-700 hover:underline" title="이 태그의 요청 보기(이달 생성 + 열린 건)">{(data.usage?.[t.id] ?? 0).toLocaleString()}</Link>
        </td>
        <td className="py-2 px-3 text-xs text-gray-500 whitespace-nowrap">{t.active ? '사용' : '숨김'}{t.code ? <span className="text-gray-400"> · 기본</span> : null}</td>
        <td className="py-2 px-3 text-right whitespace-nowrap">
          {editing ? (
            <>
              <button disabled={busy} onClick={saveEdit} className="px-2 py-1 text-xs bg-slate-900 text-white rounded disabled:opacity-50 mr-1">저장</button>
              <button onClick={() => setEdit(null)} className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50">취소</button>
            </>
          ) : t.active ? (
            <>
              <button onClick={() => setEdit({ id: t.id, label: t.label, keywords: t.keywords.join(', '), color: t.color })} className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50 mr-1">수정</button>
              <button disabled={busy} onClick={() => hide(t)} className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50">숨김</button>
            </>
          ) : (
            <button disabled={busy} onClick={() => send('PATCH', { id: t.id, active: true })} className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50">다시 사용</button>
          )}
        </td>
      </tr>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      {back}
      <h1 className="text-2xl font-bold text-gray-900 mt-1">업무 요청 태그 관리</h1>
      <p className="text-sm text-gray-500 mt-1">업무 계열 태그를 추가 · 수정 · 숨김합니다. 마스터 계정 전용입니다.</p>
      {msg && <div className="mt-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      <div className="mt-4 bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
              <th className="py-2.5 px-3 font-medium w-24">순서</th>
              <th className="py-2.5 px-3 font-medium">태그</th>
              <th className="py-2.5 px-3 font-medium">추천 키워드</th>
              <th className="py-2.5 px-3 font-medium">색</th>
              <th className="py-2.5 px-3 font-medium text-right">사용</th>
              <th className="py-2.5 px-3 font-medium">상태</th>
              <th className="py-2.5 px-3 font-medium text-right"></th>
            </tr>
          </thead>
          <tbody>
            {active.map((t, i) => row(t, i, active))}
            {hidden.map((t, i) => row(t, i, hidden))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-2">사용 중 {active.length} / 최대 {data.active_max}개{hidden.length ? ` · 숨김 ${hidden.length}개` : ''} · 사용 건수를 누르면 그 태그의 요청 목록으로 이동합니다.</p>

      <form onSubmit={add} className="mt-4 bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-sm font-bold text-gray-900">새 태그 추가</h2>
        <div className="grid gap-3 sm:grid-cols-[1.2fr_2fr_auto_auto] items-end mt-2">
          <label className="block"><span className="text-xs font-medium text-gray-600">태그 이름</span><input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} maxLength={20} placeholder="예: 명절 선물" className={`${inputCls} mt-1`} /></label>
          <label className="block"><span className="text-xs font-medium text-gray-600">추천 키워드 (쉼표로 구분)</span><input value={form.keywords} onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))} placeholder="예: 명절, 선물세트, 추석, 설" className={`${inputCls} mt-1`} /></label>
          <div><span className="block text-xs font-medium text-gray-600 mb-1">색</span>{colorSelect(form.color, v => setForm(f => ({ ...f, color: v })))}</div>
          <button type="submit" disabled={busy || active.length >= data.active_max} className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">추가</button>
        </div>
        {similarNew.length > 0 && (
          <p className="text-xs text-amber-700 mt-2">비슷한 태그가 있습니다: {similarNew.map(x => <span key={x.tag.id} className="mr-2"><b>{x.tag.label}</b> ({x.why}{x.tag.active ? '' : ' · 숨김'})</span>)}— 같은 뜻이면 기존 태그를 쓰는 편이 통계가 갈라지지 않습니다.</p>
        )}
        {active.length >= data.active_max && <p className="text-xs text-amber-700 mt-2">사용 중인 태그가 최대 {data.active_max}개입니다. 안 쓰는 태그를 숨긴 뒤 추가하세요.</p>}
      </form>

      <div className="mt-4 bg-slate-50 border border-dashed border-slate-300 rounded-xl p-4 text-xs text-gray-600 leading-relaxed">
        <p className="font-bold text-gray-900 text-sm mb-1">규칙</p>
        <p>· 삭제는 없습니다. 숨긴 태그는 새 요청에서 고를 수 없고, 과거 요청과 통계에는 그대로 남습니다.</p>
        <p>· 이름을 바꾸면 그 태그가 붙은 과거 요청도 새 이름으로 보입니다. 뜻이 달라지는 변경은 새 태그로 추가하세요.</p>
        <p>· 추천 키워드는 새 요청의 제목 · 내용에 그 단어가 있을 때 태그를 점선으로 추천하는 데만 쓰입니다. 확정은 요청자가 합니다.</p>
        <p>· 태그를 늘리면 계열별 통계가 흩어집니다. 한 달쯤 써 보고 기타에 많이 쌓이는 일이 있을 때 추가하는 것을 권합니다.</p>
      </div>
    </div>
  )
}
