'use client'

// 알림 센터 — 사이드바 종(건수) + 패널, 우하단 토스트. 데이터·폴링은 useNotifications(AreaSidebar가 소유).
// 종 숫자 = 해야 할 것 + 기다리는 것(결과 통지 제외, 2026-10-16 권장안 확정). 소리 없음.
// 2026-11-05: 종 숫자를 개인 · 공용 · 내 요청(· 기타)으로 나눠 보여준다. 사이드바 종은 세 칸 버튼 + 칸별 패널(NotificationBell),
//  확인할 것 패널(TodoPanel)은 알약(BucketPills).
// 2026-11-17(905): 결과 통지(수락 · 진행 메모 · 완료 확정 등)에 '확인' 버튼 · '모두 확인' — 확인한 것은 서버에 남겨 다시 나오지 않는다(lib/notif-read.ts).
//  바로가기로 연 결과 통지도 확인한 것으로 친다. 해야 할 것 · 기다리는 것(마감 지남 · 미확인 등)은 일이 끝나야 사라진다.

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { NOTIF_BUCKETS, NOTIF_BUCKET_LABEL, NOTIF_BUCKET_HINT, NOTIF_GROUP_LABEL, NOTIF_POLL_MS, NOTIF_SOURCE_LABEL, NOTIF_WR_PANEL_MAX, NOTIF_WR_LIST_HREF, isWrRequestItem, notifSource, type NotifBucket, type NotifData, type NotifGroup, type NotifItem } from '@/lib/notifications'
import type { Toast } from '@/lib/use-notifications'
import { canMarkRead, markNotifRead, useNotifRead } from '@/lib/notif-read'

const READ_ALL_HINT = '수락 · 진행 메모 · 완료 확정 같은 소식을 모두 확인한 것으로 처리합니다(다시 나오지 않음). 마감 지남 · 미확인처럼 처리할 일은 일이 끝나야 사라집니다.'

const DOT: Record<string, string> = { red: 'bg-red-500', amber: 'bg-amber-400', blue: 'bg-blue-500', gray: 'bg-slate-300' }
// 업무 요청 상태 표시 (2026-11-18 — 요청별 표시). 마감 지남은 빨강, 오늘 마감 · 완료 확정 대기는 주황, 그 외 회색
const FLAG_CLS: Record<string, string> = { '마감 지남': 'bg-red-100 text-red-700', '오늘 마감': 'bg-amber-100 text-amber-800', '완료 확정 대기': 'bg-amber-100 text-amber-800' }
function Flags({ item, dark }: { item: NotifItem; dark?: boolean }) {
  if (!item.flags?.length) return null
  return <>{item.flags.map(f => <span key={f} className={`inline-block text-[0.625rem] font-semibold rounded px-1 py-px ml-1 align-[1px] whitespace-nowrap ${FLAG_CLS[f] ?? (dark ? 'bg-white/15 text-slate-200' : 'bg-slate-100 text-slate-600')}`}>{f}</span>)}</>
}
// 칸마다 업무 요청 줄은 NOTIF_WR_PANEL_MAX 건까지 — 넘친 건수는 칸별로 돌려준다 (목록 링크용)
function capWr(list: NotifItem[]): { shown: NotifItem[]; over: Partial<Record<NotifBucket, number>> } {
  const seen: Partial<Record<NotifBucket, number>> = {}, over: Partial<Record<NotifBucket, number>> = {}
  const shown = list.filter(i => {
    if (!isWrRequestItem(i)) return true
    const b = i.bucket ?? 'other'
    seen[b] = (seen[b] ?? 0) + 1
    if (seen[b]! <= NOTIF_WR_PANEL_MAX) return true
    over[b] = (over[b] ?? 0) + 1
    return false
  })
  return { shown, over }
}

// 출처 꼬리표(2026-11-09) — 업무 요청 · 주문 · 휴가
function SourceTag({ item, dark }: { item: NotifItem; dark?: boolean }) {
  const src = notifSource(item.key)
  if (!src) return null
  return <span className={`inline-block text-[0.625rem] font-medium rounded px-1 py-px mr-1 align-[1px] whitespace-nowrap ${dark ? 'bg-white/15 text-slate-200' : 'bg-slate-100 text-slate-600'}`}>{NOTIF_SOURCE_LABEL[src]}</span>
}
const timeLabel = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const f = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]))
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d)
  return day === today ? `${p.hour}:${p.minute}` : `${p.month}-${p.day}`
}

// 종 숫자 나눔 — 0인 종류는 숨김. 구버전 응답(breakdown 없음)이면 합계 하나만.
function BucketPills({ data, tone }: { data: NotifData; tone: 'dark' | 'light' }) {
  const pill = tone === 'dark' ? 'bg-red-500 text-white' : 'bg-red-50 text-red-700 border border-red-200'
  if (!data.breakdown) return <span className={`text-[0.625rem] font-bold rounded-full px-1.5 py-0.5 leading-none ${pill}`}>{data.count}</span>
  return (
    <span className="flex items-center gap-1 flex-wrap justify-end">
      {NOTIF_BUCKETS.filter(b => (data.breakdown[b] ?? 0) > 0).map(b => (
        <span key={b} title={`${NOTIF_BUCKET_LABEL[b]} ${data.breakdown[b]}건`} className={`text-[0.625rem] font-semibold rounded-full px-1.5 py-0.5 leading-none whitespace-nowrap ${pill}`}>
          {NOTIF_BUCKET_LABEL[b]} {data.breakdown[b]}
        </span>
      ))}
    </span>
  )
}

// 종 — 네 칸(개인 · 공용 · 내 요청 · 주문, 주문은 2026-11-09 분리) + 기타(있을 때만). 칸을 누르면 그 종류만 보이는 패널이 열린다 (2026-11-05 사용자 요청).
//  칸 숫자 = 해야 할 것 · 기다리는 것(요청 건수, 중복 없음). 결과 통지(진행 메모 등)는 숫자에 넣지 않고, 안 본 게 있으면 파란 점.
//  패널 위 탭으로 다른 칸 · 전체를 바로 볼 수 있다.
type BellTab = NotifBucket | 'all'
const bucketOfItem = (i: NotifItem): NotifBucket => i.bucket ?? 'other'

export function NotificationBell({ data, seenAt, onSeen, live }: { data: NotifData | null; seenAt: string | null; onSeen: () => void; live?: boolean }) {
  const [tab, setTab] = useState<BellTab | null>(null)   // null = 닫힘
  const rd = useNotifRead()
  const items = rd.visible(data?.items ?? [])
  const bd = data?.breakdown ?? { personal: 0, shared: 0, mine: 0, order: 0, other: 0 }
  const groups: NotifGroup[] = ['todo', 'waiting', 'info']
  const unseenInfo = (b: NotifBucket) => items.some(i => bucketOfItem(i) === b && i.group === 'info' && (!seenAt || (!!i.at && i.at > seenAt)))
  const showOther = bd.other > 0 || items.some(i => bucketOfItem(i) === 'other')
  const cells: NotifBucket[] = showOther ? ['personal', 'shared', 'mine', 'order', 'other'] : ['personal', 'shared', 'mine', 'order']
  const capped = capWr(tab === null ? [] : tab === 'all' ? items : items.filter(i => bucketOfItem(i) === tab))
  const list = capped.shown
  const overflow = (Object.entries(capped.over) as [NotifBucket, number][]).filter(([, n]) => n > 0)
  const toggle = (b: BellTab) => setTab(t => t === b ? null : b)
  const tabs: BellTab[] = [...cells, 'all']
  const tabLabel = (t: BellTab) => t === 'all' ? '전체' : NOTIF_BUCKET_LABEL[t]
  const tabCount = (t: BellTab) => t === 'all' ? (data?.count ?? 0) : (bd[t] ?? 0)
  return (
    <>
      <div className={`mx-3 mb-2 rounded-lg border ${tab !== null ? 'border-slate-500' : 'border-slate-700'} overflow-hidden`}>
        <div className="flex items-center px-3 pt-1.5 text-[0.625rem] text-slate-500">
          <span>알림</span>
          <button onClick={() => toggle('all')} className="ml-auto hover:text-slate-200" title="전체 알림 보기">전체 보기</button>
        </div>
        <div className={`grid ${cells.length === 5 ? 'grid-cols-5' : 'grid-cols-4'} gap-px bg-slate-800`}>
          {cells.map(b => {
            const n = bd[b] ?? 0
            const on = tab === b
            return (
              <button key={b} onClick={() => toggle(b)} title={`${NOTIF_BUCKET_LABEL[b]} — ${NOTIF_BUCKET_HINT[b]}`}
                className={`relative flex flex-col items-center py-1.5 transition-colors ${on ? 'bg-slate-700' : 'bg-slate-900 hover:bg-slate-800'}`}>
                <span className={`text-[0.65625rem] ${on ? 'text-white' : 'text-slate-400'} whitespace-nowrap`}>{NOTIF_BUCKET_LABEL[b]}</span>
                <span className={`text-sm font-bold tabular-nums leading-tight ${n > 0 ? 'text-red-400' : 'text-slate-600'}`}>{n}</span>
                {unseenInfo(b) && <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-blue-400" title="새 진행 메모 · 소식" />}
              </button>
            )
          })}
        </div>
      </div>
      {tab !== null && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setTab(null)} />
          <div className="fixed left-[17rem] top-20 w-[380px] max-h-[75vh] overflow-y-auto bg-white border border-slate-300 rounded-xl shadow-2xl z-50 text-slate-900">
            <div className="sticky top-0 bg-white border-b border-slate-200">
              <div className="flex items-center px-4 pt-2.5 text-sm font-bold">
                알림 <span className="ml-auto text-[0.6875rem] font-normal text-slate-500">{seenAt ? `마지막 확인 ${timeLabel(seenAt)}` : ''}</span>
              </div>
              <div className="flex gap-1 px-3 pt-2 pb-2 overflow-x-auto">
                {tabs.map(t => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`px-2.5 py-1 rounded-full text-xs whitespace-nowrap border ${tab === t ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                    {tabLabel(t)} <span className={`tabular-nums ${tab === t ? 'text-slate-300' : tabCount(t) > 0 ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>{tabCount(t)}</span>
                  </button>
                ))}
              </div>
            </div>
            {list.length === 0 ? (
              <p className="px-4 py-8 text-sm text-slate-400 text-center">{tab === 'all' ? '확인할 알림이 없습니다.' : `${tabLabel(tab)} 알림이 없습니다.`}</p>
            ) : groups.map(g => {
              const sub = list.filter(i => i.group === g)
              if (!sub.length) return null
              return (
                <div key={g}>
                  <p className="px-4 pt-2.5 pb-1 text-[0.65625rem] text-slate-400 uppercase tracking-wide">{NOTIF_GROUP_LABEL[g]}</p>
                  {sub.map(i => {
                    const seen = !!seenAt && !!i.at && i.at <= seenAt
                    const readable = canMarkRead(i)
                    return (
                      <div key={i.key} className="relative border-b border-slate-50">
                        <Link href={i.href} onClick={() => { if (readable) rd.mark([i]); setTab(null) }}
                          className="grid grid-cols-[8px_1fr_auto] gap-2.5 px-4 py-2 hover:bg-slate-50 items-start">
                          <span className={`w-2 h-2 rounded-full mt-1.5 ${DOT[i.tone]}`} />
                          <span className="min-w-0">
                            <span className={`block text-[0.8125rem] ${seen ? 'text-slate-600' : 'font-semibold text-slate-900'}`}><SourceTag item={i} />{i.title}<Flags item={i} /></span>
                            {i.detail && <span className={`block text-[0.6875rem] text-slate-500 truncate ${readable ? 'pr-8' : ''}`}>{i.detail}</span>}
                          </span>
                          <span className="text-[0.65625rem] text-slate-400 whitespace-nowrap pt-0.5">{timeLabel(i.at)}</span>
                        </Link>
                        {readable && (
                          <button onClick={() => rd.mark([i])} title="확인 — 다시 나오지 않습니다"
                            className="absolute right-3 bottom-1.5 px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[0.625rem] text-slate-500 hover:text-slate-900 hover:border-slate-400">확인</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
            {overflow.map(([b, n]) => (
              <Link key={b} href={NOTIF_WR_LIST_HREF[b] ?? '/me/requests'} onClick={() => setTab(null)} className="block px-4 py-2 text-[0.75rem] text-slate-600 hover:bg-slate-50 border-b border-slate-50">
                {NOTIF_BUCKET_LABEL[b]} 업무 요청 외 {n}건 — 목록에서 전체 보기 →
              </Link>
            ))}
            <div className="flex items-center px-4 py-2 bg-slate-50 text-[0.6875rem] text-slate-500">
              <button onClick={() => { rd.mark(items, true); onSeen(); setTab(null) }} title={READ_ALL_HINT} className="hover:text-slate-800 underline">모두 확인</button>
              {rd.error && <span className="ml-2 text-red-600">{rd.error}</span>}
              <span className="ml-auto" title={live ? '업무 요청 변경은 즉시 반영됩니다. 폴링은 안전망.' : '실시간 신호 연결 전 — 폴링으로 갱신'}>{live ? '즉시 갱신 연결됨 · ' : ''}{Math.round(NOTIF_POLL_MS / 1000)}초마다 갱신</span>
            </div>
          </div>
        </>
      )}
    </>
  )
}

// 토스트 (2026-11-18 사용자 결정): 개수 제한 없음 · 확인하기 전까지 내려가지 않음. 많으면 목록이 스크롤되고 위에 "모두 확인".
//  확인 = 토스트만 닫는다(결과 통지면 905 확인 기록도 함께). 해야 할 일이 끝나 알림에서 사라지면 토스트도 자동으로 닫힌다(use-notifications).
export function NotificationToasts({ toasts, onDismiss, onDismissAll }: { toasts: Toast[]; onDismiss: (id: string) => void; onDismissAll?: () => void }) {
  const router = useRouter()
  if (!toasts.length) return null
  const done = (t: Toast) => { onDismiss(t.id); if (canMarkRead(t.item)) markNotifRead([t.item.key]) }
  return (
    <div className="fixed right-4 bottom-4 z-50 w-[340px] max-h-[80vh] flex flex-col">
      {toasts.length > 1 && (
        <div className="flex items-center mb-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs shadow-lg">
          새 알림 {toasts.length}건
          <button onClick={() => { const keys = toasts.filter(t => canMarkRead(t.item)).map(t => t.item.key); if (keys.length) markNotifRead(keys); onDismissAll?.() }} className="ml-auto underline hover:text-white">모두 확인</button>
        </div>
      )}
      <div className="flex flex-col gap-2 overflow-y-auto pr-0.5">
        {toasts.map(t => (
          <div key={t.id} className="bg-slate-900 text-white rounded-xl shadow-2xl px-4 py-3 text-sm shrink-0">
            <div className="flex items-start gap-2">
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${DOT[t.item.tone]}`} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold"><SourceTag item={t.item} dark />{t.item.title}<Flags item={t.item} dark /></p>
                {t.item.detail && <p className="text-xs text-slate-300 mt-0.5 truncate">{t.item.detail}</p>}
              </div>
            </div>
            <div className="flex gap-1.5 mt-2.5">
              <button onClick={() => { done(t); router.push(t.item.href) }} className="px-2.5 py-1 rounded-md bg-white text-slate-900 text-xs font-semibold">열기</button>
              <button onClick={() => done(t)} className="px-2.5 py-1 rounded-md bg-white/10 text-xs hover:bg-white/20">확인</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// 로그인 직후 "확인할 것" — 업무 선택(dark)·내 대시보드(light). 자체 1회 조회. 0건이면 렌더하지 않는다.
export function TodoPanel({ variant, data }: { variant: 'dark' | 'light'; data: NotifData | null }) {
  const rd = useNotifRead()
  const items = rd.visible(data?.items ?? [])
  if (!data || items.length === 0) return null
  // 요약 유지(2026-11-18): 업무 요청은 요청별로 오지만 여기서는 "개인 요청 마감 지남 2건"처럼 묶어 보인다 (1건이면 그 요청으로 바로)
  const rows: { key: string; item: NotifItem; members: NotifItem[] }[] = []
  for (const i of items) {
    if (!i.sum) { rows.push({ key: i.key, item: i, members: [i] }); continue }
    const row = rows.find(r => r.key === i.sum!.key)
    if (row) row.members.push(i)
    else rows.push({ key: i.sum.key, item: i, members: [i] })
  }
  const view = rows.map(r => r.members.length === 1 && !r.item.sum ? r : {
    ...r, item: { ...r.item, title: r.item.sum!.label, count: r.members.length, href: r.members.length === 1 ? r.item.href : r.item.sum!.href, flags: undefined },
  })
  const dark = variant === 'dark'
  const infoCount = items.filter(canMarkRead).length
  const btn = dark ? 'border-slate-600 text-slate-300 hover:text-white hover:border-slate-400' : 'border-slate-300 text-slate-600 hover:text-slate-900 hover:border-slate-500'
  const pill = (i: NotifItem) => i.tone === 'red' ? 'bg-red-500 text-white' : i.tone === 'amber' ? 'bg-amber-400 text-slate-900' : i.tone === 'blue' ? 'bg-blue-500 text-white' : 'bg-slate-300 text-slate-800'
  return (
    <div className={`${dark ? 'bg-white/5 border border-slate-700 text-slate-100' : 'bg-white border border-slate-200 text-slate-900'} rounded-xl px-4 py-3 text-left`}>
      <div className="flex items-center text-sm font-bold">
        확인할 것
        <span className={`ml-auto flex items-center gap-2 text-[0.6875rem] font-normal ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
          {data.count > 0 && <BucketPills data={data} tone={dark ? 'dark' : 'light'} />}{timeLabel(data.at)} 기준
          {infoCount > 0 && <button onClick={() => rd.mark(items, true)} title={READ_ALL_HINT} className={`px-2 py-0.5 rounded border font-medium ${btn}`}>모두 확인 {infoCount}</button>}
        </span>
      </div>
      {rd.error && <p className="mt-1 text-[0.6875rem] text-red-500">{rd.error}</p>}
      <ul className="mt-2">
        {view.map(({ key, item: i, members }) => (
          <li key={key} className={`flex items-center gap-2.5 py-1.5 text-[0.8125rem] border-t ${dark ? 'border-slate-800' : 'border-slate-100'}`}>
            <span className={`text-[0.625rem] font-bold rounded-full px-1.5 py-0.5 leading-none ${pill(i)}`}>{i.count}</span>
            <span className="truncate"><SourceTag item={i} dark={dark} />{i.title.replace(/\s\d+건$/, '')}</span>
            {canMarkRead(i) && <button onClick={() => rd.mark(members)} title="확인 — 다시 나오지 않습니다" className={`ml-auto px-1.5 py-0.5 rounded border text-[0.625rem] whitespace-nowrap ${btn}`}>확인</button>}
            <Link href={i.href} onClick={() => { if (canMarkRead(i) && members.length === 1) rd.mark(members) }} className={`${canMarkRead(i) ? '' : 'ml-auto '}text-[0.6875rem] whitespace-nowrap hover:underline ${dark ? 'text-sky-300' : 'text-blue-600'}`}>바로가기 →</Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
