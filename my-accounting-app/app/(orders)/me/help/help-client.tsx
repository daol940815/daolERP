'use client'

// 도움말 전체 목록(검색 · 펼침) + 점검 탭(마스터) — help-registry 단일 원천.
// 검색은 제목 · 키워드 · 본문 · FAQ 질문을 모두 본다(2차 Ctrl K 검색의 바탕). 점검: 항목별 최근 확인일 · 변경 · 30일 질문 건수 · 미작성 목록.

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { HELP, HELP_PENDING, HELP_QUESTION_RECIPIENT_NAME, type HelpEntry } from '@/lib/help-registry'
import { MENU } from '@/lib/menu-registry'
import { questionHref } from '@/components/help/HelpLauncher'

const GROUP_LABEL: Record<string, string> = Object.fromEntries(MENU.map(g => [g.key, g.label]))
const menuLabel = (href: string) => { for (const g of MENU) for (const it of g.items) if (it.href === href) return it.label; return href }

export default function HelpClient({ tab, initialQuery }: { tab: 'list' | 'audit'; initialQuery: string }) {
  if (tab === 'audit') return <AuditTab />
  return <ListTab initialQuery={initialQuery} />
}

function ListTab({ initialQuery }: { initialQuery: string }) {
  const [q, setQ] = useState(initialQuery)
  const [openHref, setOpenHref] = useState<string | null>(null)
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return HELP
    return HELP.filter(h => [h.title, h.what, h.who, ...h.keywords, ...h.steps, ...h.faq.map(f => f.q + ' ' + f.a)].join(' ').toLowerCase().includes(s))
  }, [q])
  const grouped = useMemo(() => {
    const m = new Map<string, HelpEntry[]>()
    for (const h of matches) m.set(GROUP_LABEL[h.group] ?? h.group, [...(m.get(GROUP_LABEL[h.group] ?? h.group) ?? []), h])
    return Array.from(m.entries())
  }, [matches])

  return (
    <div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="화면 이름이나 하려는 일을 입력 (예: 원가표, 휴가 신청, 수금)" autoFocus
        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 mb-4" />
      {grouped.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-600">
          맞는 도움말이 없습니다. <Link href={questionHref(null, '/me/help')} className="underline text-slate-900 font-medium">질문하기</Link> — {HELP_QUESTION_RECIPIENT_NAME}가 답합니다.
        </div>
      )}
      <div className="space-y-5">
        {grouped.map(([g, list]) => (
          <section key={g}>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">{g}</h2>
            <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
              {list.map(h => {
                const open = openHref === h.href
                return (
                  <div key={h.href}>
                    <button onClick={() => setOpenHref(open ? null : h.href)} className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-gray-50">
                      <span className="font-semibold text-gray-900">{h.title}</span>
                      {h.changes?.[0] && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">바뀜 {h.changes[0].date.slice(5)}</span>}
                      <span className="text-xs text-gray-500 truncate flex-1">{h.what}</span>
                      <span className="text-xs text-gray-400">{open ? '접기' : '펼치기'}</span>
                    </button>
                    {open && (
                      <div className="px-5 pb-4 text-sm space-y-3">
                        {h.changes && h.changes.length > 0 && <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-900 space-y-0.5">{h.changes.slice(0, 3).map((c, i) => <p key={i}><span className="tabular-nums mr-1.5 text-emerald-700">{c.date.slice(5)}</span>{c.text}</p>)}</div>}
                        <p><b className="text-gray-500 text-xs uppercase mr-2">이 화면은</b>{h.what}</p>
                        <p><b className="text-gray-500 text-xs uppercase mr-2">누가 · 언제</b>{h.who}</p>
                        <div><b className="text-gray-500 text-xs uppercase">순서</b><ol className="list-decimal ml-5 mt-1 space-y-0.5">{h.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></div>
                        <div><b className="text-gray-500 text-xs uppercase">자주 막히는 것</b><div className="mt-1 divide-y divide-dashed divide-gray-200">{h.faq.map((f, i) => <div key={i} className="py-1.5"><p className="font-semibold text-gray-900">{f.q}</p><p className="text-gray-600">{f.a}</p></div>)}</div></div>
                        <div className="flex items-center gap-2 pt-1">
                          <Link href={h.href} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-700">화면 열기</Link>
                          <Link href={questionHref(h, h.href)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-700 hover:bg-gray-50">이 화면에 대해 질문하기</Link>
                          <span className="ml-auto text-[11px] text-gray-400">최근 확인 {h.updated}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-5">아직 도움말이 없는 화면 {HELP_PENDING.length}개는 차례로 채웁니다. 그 화면에서도 질문하기는 됩니다.</p>
    </div>
  )
}

interface Audit { since: string; questions: { screen: string; count: number; open: number }[]; total: number; error?: string }

function AuditTab() {
  const [a, setA] = useState<Audit | null>(null)
  useEffect(() => { fetch('/api/help/audit', { cache: 'no-store' }).then(r => r.json()).then(setA).catch(() => setA({ since: '', questions: [], total: 0, error: '조회 실패' })) }, [])
  const qBy = new Map((a?.questions ?? []).map(x => [x.screen, x]))
  const stale = (h: HelpEntry) => { const d = (Date.now() - new Date(h.updated).getTime()) / 86400_000; return d > 60 }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['도움말 항목', HELP.length], ['미작성 화면', HELP_PENDING.length], ['60일 이상 미확인', HELP.filter(stale).length], [`최근 30일 질문 · 권한 요청`, a?.total ?? '-']].map(([k, v]) => (
          <div key={String(k)} className="bg-white border border-gray-200 rounded-xl px-4 py-3"><p className="text-xs text-gray-500">{k}</p><p className="text-lg font-bold tabular-nums">{v}</p></div>
        ))}
      </div>
      {a?.error && <div className="px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">{a.error}</div>}
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><th className="py-2 px-4 font-medium">화면</th><th className="py-2 px-4 font-medium">최근 확인</th><th className="py-2 px-4 font-medium">최근 변경</th><th className="py-2 px-4 font-medium text-right">30일 질문</th><th className="py-2 px-4 font-medium text-right">그중 미완료</th></tr></thead>
          <tbody>
            {HELP.map(h => { const x = qBy.get(h.title); return (
              <tr key={h.href} className="border-b border-gray-50">
                <td className="py-2 px-4"><Link href={h.href} className="font-medium text-gray-900 hover:underline">{h.title}</Link><span className="text-xs text-gray-400 ml-2">{h.href}</span></td>
                <td className={`py-2 px-4 tabular-nums ${stale(h) ? 'text-amber-600 font-medium' : 'text-gray-600'}`}>{h.updated}{stale(h) ? ' (60일+)' : ''}</td>
                <td className="py-2 px-4 text-xs text-gray-500">{h.changes?.[0] ? `${h.changes[0].date} ${h.changes[0].text}` : '-'}</td>
                <td className={`py-2 px-4 text-right tabular-nums ${x && x.count >= 2 ? 'text-red-600 font-semibold' : ''}`}>{x?.count ?? 0}</td>
                <td className="py-2 px-4 text-right tabular-nums">{x?.open ?? 0}</td>
              </tr>
            ) })}
          </tbody>
        </table>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-sm font-bold text-gray-900 mb-2">도움말 미작성 화면 <span className="text-xs text-gray-400 font-normal">{HELP_PENDING.length}개 — 항목을 쓰면 help-registry 의 HELP_PENDING 에서 지운다</span></h2>
        <div className="flex flex-wrap gap-1.5">{HELP_PENDING.map(p => <span key={p} className="px-2 py-1 rounded-full bg-gray-100 text-xs text-gray-700">{menuLabel(p)}{qBy.get(menuLabel(p))?.count ? <b className="text-red-600 ml-1">질문 {qBy.get(menuLabel(p))!.count}</b> : null}</span>)}</div>
      </div>
      <p className="text-xs text-gray-400">질문이 2건 이상인 화면은 빨간색 — 그 답을 도움말 &quot;자주 막히는 것&quot;에 옮길 차례입니다. 화면 파일이 도움말보다 뒤에 바뀐 항목은 빌드 로그(check-help)에 경고로 나옵니다.</p>
    </div>
  )
}
