'use client'

// 화면별 도움말 버튼 + 패널 (도움말 트랙 1차, 2026-11-03). 사이드바 하단 고정 영역에 있다 — 화면마다 손대지 않는다.
// 2026-11-05: 본문 오른쪽 위에 떠 있던 버튼이 '+ 상담 기록' · '+ 주문 추가' 같은 화면 주요 버튼을 가린다는 의견 → 사이드바 하단으로 이동,
//  패널은 화면 오른쪽 고정 서랍, 키보드 F1 로도 열고 닫는다.
// 현재 경로(+탭)에 맞는 항목을 help-registry 에서 찾아 네 칸(이 화면은 · 누가 언제 · 순서 · 자주 막히는 것)으로 보여준다.
// 권한 안내: 이 화면 조작에 필요한 그룹의 내 수준이 '수정' 미만이면 "권한 요청하기" (→ 업무 요청 [권한]).
// 질문하기: → /me/requests/new?question=<경로>&screen=<화면명> (담당자 오철준 대리 · 제목 [질문] 자동).
// 최근 바뀐 것: changes 를 패널 맨 위에, 그 화면을 변경 뒤 처음 방문하면 버튼 옆에 "새로 바뀐 것" 표시. 본 기록은 localStorage.

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { findHelp, helpByHref, HELP_RECENT_DAYS, HELP_QUESTION_RECIPIENT_NAME, PERMISSION_CONTACT, type HelpEntry } from '@/lib/help-registry'
import { GROUP_LABELS, type GroupKey, type PermLevel } from '@/lib/permissions'

export const HELP_SEEN_KEY = 'help-seen'
export const HELP_SEEN_EVENT = 'daol:help-seen'
export function readSeen(): Record<string, string> { try { return JSON.parse(localStorage.getItem(HELP_SEEN_KEY) ?? '{}') } catch { return {} } }
export function markSeen(href: string, date: string) {
  try { const m = readSeen(); if ((m[href] ?? '') < date) { m[href] = date; localStorage.setItem(HELP_SEEN_KEY, JSON.stringify(m)); window.dispatchEvent(new Event(HELP_SEEN_EVENT)) } } catch { /* 무시 */ }
}
const base = (href: string) => href.split('?')[0]

export function questionHref(entry: HelpEntry | null, pathname: string, kind: 'question' | 'perm' = 'question') {
  const p = new URLSearchParams({ question: entry ? entry.href : pathname, screen: entry?.title ?? pathname })
  if (kind === 'perm' && entry && entry.group !== 'my' && entry.group !== 'team') p.set('perm', entry.group)
  return `/me/requests/new?${p}`
}

export default function HelpLauncher({ levels }: { levels: Partial<Record<GroupKey, PermLevel>> }) {
  const pathname = usePathname()
  const sp = useSearchParams()
  const [open, setOpen] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null)   // 변경 뒤 첫 방문 표시용 최신 변경일
  const entry = useMemo(() => findHelp(pathname, sp.toString()), [pathname, sp])

  // 화면 이동 시 닫기 + 최근 변경 본 처리
  useEffect(() => {
    setOpen(false)
    if (!entry) { setFresh(null); return }
    const latest = entry.changes?.[0]?.date ?? null
    const cutoff = new Date(Date.now() - HELP_RECENT_DAYS * 86400_000).toISOString().slice(0, 10)
    if (latest && latest >= cutoff && (readSeen()[base(entry.href)] ?? '') < latest) { setFresh(latest); markSeen(base(entry.href), latest) }
    else setFresh(null)
  }, [entry, pathname])

  // F1 = 이 화면 도움말 열기/닫기, Esc = 닫기 (브라우저 기본 F1 도움말은 막는다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); setOpen(o => !o) }
      else if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const group = entry?.group
  const level: PermLevel | null = group && group !== 'my' && group !== 'team' ? (levels[group] ?? 'none') : null
  const needsEdit = level !== null && level !== 'edit'
  const freshCount = fresh ? (entry?.changes?.filter(c => c.date >= (new Date(Date.now() - HELP_RECENT_DAYS * 86400_000).toISOString().slice(0, 10))).length ?? 0) : 0

  return (
    <>
      <button onClick={() => setOpen(o => !o)} title="이 화면 도움말 (F1)"
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${open ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
        <span className={`w-4 h-4 rounded-full text-[0.625rem] font-extrabold inline-flex items-center justify-center shrink-0 ${open ? 'bg-white text-slate-900' : 'bg-slate-600 text-white'}`}>?</span>
        <span>이 화면 도움말</span>
        {fresh && !open
          ? <span className="ml-auto text-[0.625rem] px-1.5 py-0.5 rounded-full bg-emerald-600 text-white leading-none" title="이 화면에 최근 바뀐 것이 있습니다">새로 바뀜 {freshCount}</span>
          : <span className="ml-auto text-[0.625rem] text-slate-500">F1</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60] bg-slate-900/10" onClick={() => setOpen(false)} />
          <aside className="fixed top-0 right-0 bottom-0 w-full sm:w-[380px] bg-white border-l border-gray-200 shadow-2xl z-[61] overflow-y-auto text-sm text-left">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-3 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[0.6875rem] font-extrabold inline-flex items-center justify-center">?</span>
              <h2 className="font-bold text-gray-900 text-base truncate">{entry?.title ?? '이 화면'}</h2>
              <button onClick={() => setOpen(false)} className="ml-auto text-xs text-gray-400 hover:text-gray-700">닫기 ✕</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {!entry ? (
                <>
                  <p className="text-gray-600 leading-relaxed">이 화면의 도움말은 아직 준비 중입니다. 막히는 점은 바로 질문해 주세요 — {HELP_QUESTION_RECIPIENT_NAME}가 답합니다.</p>
                  <Link href={questionHref(null, pathname)} className="inline-block px-3 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700">이 화면에 대해 질문하기</Link>
                  <p><Link href="/me/help" className="text-xs text-slate-600 underline">전체 도움말 목록</Link></p>
                </>
              ) : (
                <>
                  {entry.changes && entry.changes.length > 0 && (
                    <section className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
                      <h3 className="text-[0.6875rem] font-bold text-emerald-800 uppercase tracking-wide mb-1">최근 바뀐 것</h3>
                      <ul className="space-y-1">
                        {entry.changes.slice(0, 3).map((c, i) => <li key={i} className="text-xs text-emerald-900 leading-relaxed"><span className="tabular-nums text-emerald-700 mr-1.5">{c.date.slice(5)}</span>{c.text}</li>)}
                      </ul>
                    </section>
                  )}
                  {needsEdit && (
                    <section className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-900 leading-relaxed">
                      <b>권한 안내</b> — 이 화면의 등록 · 수정은 <b>{GROUP_LABELS[group as GroupKey]} 그룹 수정 권한</b>이 필요합니다. 지금 계정은 {level === 'view' ? '조회만' : '접근 불가'}입니다.
                      {PERMISSION_CONTACT[group as string] && <span> 담당: {PERMISSION_CONTACT[group as string]}.</span>}
                      <div className="mt-2"><Link href={questionHref(entry, pathname, 'perm')} className="inline-block px-2.5 py-1 bg-amber-700 text-white rounded text-xs font-medium hover:bg-amber-800">권한 요청하기</Link></div>
                    </section>
                  )}
                  <Section title="이 화면은"><p className="text-gray-800 leading-relaxed">{entry.what}</p></Section>
                  <Section title="누가 · 언제"><p className="text-gray-800 leading-relaxed">{entry.who}</p></Section>
                  <Section title="순서"><ol className="list-decimal ml-4 space-y-1 text-gray-800 leading-relaxed">{entry.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></Section>
                  <Section title="자주 막히는 것">
                    <div className="divide-y divide-dashed divide-gray-200">
                      {entry.faq.map((f, i) => <div key={i} className="py-2"><p className="font-semibold text-gray-900">{f.q}</p><p className="text-gray-600 leading-relaxed mt-0.5">{f.a}</p></div>)}
                    </div>
                  </Section>
                  {entry.related && entry.related.some(r => helpByHref(r)) && (
                    <Section title="관련 화면">
                      <div className="flex flex-wrap gap-1.5">{entry.related.map(r => { const h = helpByHref(r); return h ? <Link key={r} href={r} className="px-2 py-1 rounded-full border border-gray-300 text-xs text-gray-700 hover:bg-gray-50">{h.title}</Link> : null })}</div>
                    </Section>
                  )}
                  <div className="border-t border-gray-200 pt-3 flex items-center gap-2 flex-wrap">
                    <Link href={questionHref(entry, pathname)} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-700">이 화면에 대해 질문하기</Link>
                    <Link href="/me/help" className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-700 hover:bg-gray-50">전체 도움말 목록</Link>
                    <span className="ml-auto text-[0.6875rem] text-gray-400">최근 확인 {entry.updated}</span>
                  </div>
                </>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="text-[0.6875rem] font-bold text-gray-400 uppercase tracking-wide mb-1.5">{title}</h3>{children}</section>
}
