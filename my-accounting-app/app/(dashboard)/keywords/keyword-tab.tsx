'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { KpiCard, KpiGrid, TableCard, btnCls, chipCls, fieldBox, tbl } from '@/components/ui/kit'

// 키워드 관리 탭 — 통장 · 계산서 같은 모양 (2026-11-26, 서버 lib/keyword-admin.ts)
type Tab = 'bank' | 'invoice'
interface Kw { text: string; hits: number; dup_with: string[]; suspicious: string | null }
interface V { id: string; name: string; type: string | null; keywords: Kw[] }
type Kpi = 'all' | 'dup' | 'sus' | 'unused'

const TYPE_LABEL: Record<string, string> = { customer: '매출처', vendor: '매입처', both: '매출 · 매입' }
const SOURCE: Record<Tab, { word: string; hitWord: string; usedBy: string }> = {
  bank: { word: '통장 키워드', hitWord: '걸린 입금', usedBy: '통장 입금의 입금자 · 적요로 거래처를 알아볼 때 씁니다 — 통장 분류(자동 거래처 연결) · 결제 확인 매칭 대기 "키워드 일치" · 입금대장.' },
  invoice: { word: '계산서 키워드', hitWord: '걸린 계산서', usedBy: '홈택스 계산서의 상대 상호로 거래처를 알아볼 때 씁니다. 거래처 이름을 바꾸면 옛 이름이 여기 들어가고, 청구처 · 거래처 이름 검색에도 쓰입니다.' },
}

export default function KeywordTabView({ tab }: { tab: Tab }) {
  const [rows, setRows] = useState<V[]>([])
  const [since, setSince] = useState('')
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [kpi, setKpi] = useState<Kpi>('all')
  const [kind, setKind] = useState<'all' | 'customer' | 'vendor'>('all')
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [shown, setShown] = useState(100)
  const S = SOURCE[tab]

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const res = await fetch(`/api/keywords?tab=${tab}`)
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setError(j.error ?? '조회 실패'); setRows([]) }
    else { setRows(j.vendors ?? []); setSince(j.since ?? ''); setCanEdit(!!j.can_edit) }
    setLoading(false)
  }, [tab])
  useEffect(() => { load() }, [load])

  const all = useMemo(() => rows.flatMap(v => v.keywords), [rows])
  const counts = {
    vendors: rows.length, keywords: all.length,
    dup: all.filter(k => k.dup_with.length).length, sus: all.filter(k => k.suspicious).length, unused: all.filter(k => !k.hits).length,
  }
  const pass = (k: Kw) => kpi === 'all' || (kpi === 'dup' ? k.dup_with.length > 0 : kpi === 'sus' ? !!k.suspicious : k.hits === 0)
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/\s+/g, '')
    return rows.filter(v => {
      if (kind === 'customer' && !(v.type === 'customer' || v.type === 'both')) return false
      if (kind === 'vendor' && !(v.type === 'vendor' || v.type === 'both')) return false
      if (!v.keywords.some(pass)) return false
      if (!s) return true
      return v.name.toLowerCase().replace(/\s+/g, '').includes(s) || v.keywords.some(k => k.text.toLowerCase().replace(/\s+/g, '').includes(s))
    })
  }, [rows, kind, q, kpi]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setShown(100) }, [kind, q, kpi])

  const patch = async (v: V, body: { add?: string; remove?: string }) => {
    setBusy(v.id); setMsg(null)
    const res = await fetch('/api/keywords', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tab, vendor_id: v.id, ...body }) })
    const j = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { setMsg(j.error ?? '저장 실패'); return false }
    setMsg(body.add ? `${v.name}에 "${body.add}"를 추가했습니다.${j.warning ? ` 주의: ${j.warning}` : ''}` : `${v.name}에서 "${body.remove}"를 뺐습니다.`)
    load()
    return true
  }
  const remove = (v: V, k: Kw) => {
    const extra = tab === 'invoice' ? ' 옛 이름 · 별칭 검색에서도 빠집니다.' : ''
    if (!confirm(`"${k.text}"를 ${v.name} ${S.word}에서 뺍니다.\n이미 연결된 ${tab === 'bank' ? '통장 입금 · 매칭' : '계산서'}은 그대로이고, 앞으로의 추천 · 자동 연결에만 영향이 있습니다.${extra}`)) return
    patch(v, { remove: k.text })
  }
  const add = async (v: V) => {
    const t = (draft[v.id] ?? '').trim()
    if (!t) return
    if (await patch(v, { add: t })) setDraft(d => ({ ...d, [v.id]: '' }))
  }
  const hitHref = (kw: string) => tab === 'bank' ? `/transactions?q=${encodeURIComponent(kw)}` : `/tax-invoices?q=${encodeURIComponent(kw)}`

  return (
    <div className="w-full">
      <p className="text-sm text-slate-600 mb-2">{S.usedBy} 걸린 수는 {since ? `${since} 이후` : `최근 6개월`} 원본 기준입니다.</p>
      {msg && <div className="mb-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="mb-3 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}

      <KpiGrid cols={4}>
        <KpiCard label="키워드 있는 거래처" value={`${counts.vendors}곳`} sub={`키워드 ${counts.keywords}개`} active={kpi === 'all'} onClick={() => setKpi('all')} />
        <KpiCard label="다른 거래처와 겹침" value={`${counts.dup}개`} sub={tab === 'bank' ? '겹치면 자동 연결이 둘 다 건너뜀' : '같은 상호가 두 거래처에 걸림'} tone="amber" active={kpi === 'dup'} onClick={() => setKpi('dup')} />
        <KpiCard label="의심 키워드" value={`${counts.sus}개`} sub="숫자만 · 2글자 이하 · 흔한 말" tone="red" active={kpi === 'sus'} onClick={() => setKpi('sus')} />
        <KpiCard label="최근 6개월 안 쓰임" value={`${counts.unused}개`} sub={`${S.hitWord} 0건`} active={kpi === 'unused'} onClick={() => setKpi('unused')} />
      </KpiGrid>

      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="거래처 이름 · 키워드 검색" className={fieldBox({ noWidth: true, extra: 'w-64 mr-1.5' })} />
        {([['all', '전체'], ['customer', '매출처'], ['vendor', '매입처']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setKind(k)} className={chipCls(kind === k)}>{l}</button>
        ))}
      </div>

      {loading ? <div className="text-center py-20 text-slate-500">불러오는 중...</div>
        : filtered.length === 0 ? <div className="text-center py-20 text-slate-500 text-sm">{rows.length ? '조건에 맞는 거래처가 없습니다.' : `${S.word}가 있는 거래처가 없습니다.`}</div>
        : (
          <TableCard>
            <table className={tbl.table}>
              <thead>
                <tr><th className={tbl.th}>거래처</th><th className={tbl.th}>구분</th><th className={tbl.th}>{S.word}</th><th className={tbl.thNum}>{S.hitWord}</th></tr>
              </thead>
              <tbody>
                {filtered.slice(0, shown).map(v => {
                  const kws = v.keywords.filter(k => kpi === 'all' || pass(k))
                  const notes = v.keywords.filter(k => k.dup_with.length || k.suspicious)
                  return (
                    <tr key={v.id} className={tbl.tr}>
                      <td className={tbl.td}>
                        <span className={tbl.name}>{v.name}</span>
                        <Link href={v.type === 'vendor' ? `/purchase-hub/${v.id}` : `/sales-hub/${v.id}`} className={tbl.sub + ' underline'}>{v.type === 'vendor' ? '매입처 허브' : '매출처 허브'}</Link>
                      </td>
                      <td className={tbl.td + ' text-xs whitespace-nowrap'}>{TYPE_LABEL[v.type ?? ''] ?? '-'}</td>
                      <td className={tbl.td}>
                        <div className="flex flex-wrap gap-1">
                          {kws.map(k => (
                            <span key={k.text} title={[k.dup_with.length ? `다른 거래처에도 있음: ${k.dup_with.join(', ')}` : '', k.suspicious ?? ''].filter(Boolean).join(' · ') || undefined}
                              className={`inline-flex items-center gap-1 rounded-full border pl-2 pr-1 py-0.5 text-xs ${k.suspicious ? 'border-red-300 bg-red-50' : k.dup_with.length ? 'border-amber-300 bg-amber-50' : 'border-slate-400 bg-white'}`}>
                              <span className="text-slate-900">{k.text}</span>
                              <a href={hitHref(k.text)} className="text-slate-600 tabular-nums underline" title={`${S.hitWord} — 누르면 원본 목록`}>{k.hits}</a>
                              {canEdit && <button onClick={() => remove(v, k)} disabled={busy === v.id} aria-label={`${k.text} 삭제`}
                                className="w-4 h-4 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 leading-none disabled:opacity-40">×</button>}
                            </span>
                          ))}
                        </div>
                        {notes.map(k => (
                          <div key={k.text} className={`text-xs mt-0.5 ${k.suspicious ? 'text-red-700' : 'text-amber-700'}`}>
                            &quot;{k.text}&quot; — {k.dup_with.length ? `${k.dup_with.slice(0, 3).join(', ')}${k.dup_with.length > 3 ? ` 외 ${k.dup_with.length - 3}곳` : ''}에도 있음${tab === 'bank' ? ' (자동 연결은 둘 다 건너뜀)' : ''}` : ''}{k.dup_with.length && k.suspicious ? ' · ' : ''}{k.suspicious ?? ''}
                          </div>
                        ))}
                        {canEdit && (
                          <div className="flex items-center gap-1 mt-1">
                            <input value={draft[v.id] ?? ''} onChange={e => setDraft(d => ({ ...d, [v.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') add(v) }}
                              placeholder="키워드 추가" className={fieldBox({ noWidth: true, size: 'sm', extra: 'w-36' })} />
                            <button onClick={() => add(v)} disabled={busy === v.id || !(draft[v.id] ?? '').trim()} className={btnCls('secondary', 'sm')}>추가</button>
                          </div>
                        )}
                      </td>
                      <td className={tbl.tdNum}>{v.keywords.reduce((s, k) => s + k.hits, 0).toLocaleString('ko-KR')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filtered.length > shown && (
              <div className="p-3 text-center border-t border-slate-200">
                <button onClick={() => setShown(n => n + 100)} className={btnCls('secondary')}>더 보기 ({shown} / {filtered.length})</button>
              </div>
            )}
          </TableCard>
        )}

      <p className="text-xs text-slate-500 mt-3 leading-relaxed">
        키워드를 빼도 이미 연결된 원본은 그대로입니다 — 앞으로의 추천 · 자동 연결에만 영향이 있습니다. 누가 · 언제 넣었는지는 기록돼 있지 않습니다.
        {tab === 'bank' ? ' 통장 키워드는 결제 확인에서 입금을 확정할 때 자동으로 쌓입니다(체크 칸).' : ' 계산서 키워드는 매출처 · 매입처 연결 키워드 화면의 거래처 펼침에서도 고칠 수 있습니다(같은 칸).'}
      </p>
    </div>
  )
}
