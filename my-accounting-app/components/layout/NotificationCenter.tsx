'use client'

// 알림 센터 — 사이드바 종(건수) + 패널, 우하단 토스트. 데이터·폴링은 useNotifications(AreaSidebar가 소유).
// 종 숫자 = 해야 할 것 + 기다리는 것(결과 통지 제외, 2026-10-16 권장안 확정). 소리 없음.
// 2026-11-05: 종 숫자를 개인 · 공용 · 내 요청(· 기타)으로 나눠 보여준다. 사이드바 종은 세 칸 버튼 + 칸별 패널(NotificationBell),
//  확인할 것 패널(TodoPanel)은 알약(BucketPills).

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { NOTIF_BUCKETS, NOTIF_BUCKET_LABEL, NOTIF_GROUP_LABEL, NOTIF_POLL_MS, type NotifBucket, type NotifData, type NotifGroup, type NotifItem } from '@/lib/notifications'
import type { Toast } from '@/lib/use-notifications'

const DOT: Record<string, string> = { red: 'bg-red-500', amber: 'bg-amber-400', blue: 'bg-blue-500', gray: 'bg-slate-300' }
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
  if (!data.breakdown) return <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none ${pill}`}>{data.count}</span>
  return (
    <span className="flex items-center gap-1 flex-wrap justify-end">
      {NOTIF_BUCKETS.filter(b => data.breakdown[b] > 0).map(b => (
        <span key={b} title={`${NOTIF_BUCKET_LABEL[b]} ${data.breakdown[b]}건`} className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 leading-none whitespace-nowrap ${pill}`}>
          {NOTIF_BUCKET_LABEL[b]} {data.breakdown[b]}
        </span>
      ))}
    </span>
  )
}

// 종 — 세 칸(개인 · 공용 · 내 요청) + 기타(있을 때만). 칸을 누르면 그 종류만 보이는 패널이 열린다 (2026-11-05 사용자 요청).
//  칸 숫자 = 해야 할 것 · 기다리는 것(요청 건수, 중복 없음). 결과 통지(진행 메모 등)는 숫자에 넣지 않고, 안 본 게 있으면 파란 점.
//  패널 위 탭으로 다른 칸 · 전체를 바로 볼 수 있다.
type BellTab = NotifBucket | 'all'
const bucketOfItem = (i: NotifItem): NotifBucket => i.bucket ?? 'other'

export function NotificationBell({ data, seenAt, onSeen, live }: { data: NotifData | null; seenAt: string | null; onSeen: () => void; live?: boolean }) {
  const [tab, setTab] = useState<BellTab | null>(null)   // null = 닫힘
  const items = data?.items ?? []
  const bd = data?.breakdown ?? { personal: 0, shared: 0, mine: 0, other: 0 }
  const groups: NotifGroup[] = ['todo', 'waiting', 'info']
  const unseenInfo = (b: NotifBucket) => items.some(i => bucketOfItem(i) === b && i.group === 'info' && (!seenAt || (!!i.at && i.at > seenAt)))
  const showOther = bd.other > 0 || items.some(i => bucketOfItem(i) === 'other')
  const cells: NotifBucket[] = showOther ? ['personal', 'shared', 'mine', 'other'] : ['personal', 'shared', 'mine']
  const list = tab === null ? [] : tab === 'all' ? items : items.filter(i => bucketOfItem(i) === tab)
  const toggle = (b: BellTab) => setTab(t => t === b ? null : b)
  const tabs: BellTab[] = [...cells, 'all']
  const tabLabel = (t: BellTab) => t === 'all' ? '전체' : NOTIF_BUCKET_LABEL[t]
  const tabCount = (t: BellTab) => t === 'all' ? (data?.count ?? 0) : bd[t]
  return (
    <>
      <div className={`mx-3 mb-2 rounded-lg border ${tab !== null ? 'border-slate-500' : 'border-slate-700'} overflow-hidden`}>
        <div className="flex items-center px-3 pt-1.5 text-[10px] text-slate-500">
          <span>알림</span>
          <button onClick={() => toggle('all')} className="ml-auto hover:text-slate-200" title="전체 알림 보기">전체 보기</button>
        </div>
        <div className={`grid ${cells.length === 4 ? 'grid-cols-4' : 'grid-cols-3'} gap-px bg-slate-800`}>
          {cells.map(b => {
            const n = bd[b]
            const on = tab === b
            return (
              <button key={b} onClick={() => toggle(b)} title={`${NOTIF_BUCKET_LABEL[b]} 알림`}
                className={`relative flex flex-col items-center py-1.5 transition-colors ${on ? 'bg-slate-700' : 'bg-slate-900 hover:bg-slate-800'}`}>
                <span className={`text-[10.5px] ${on ? 'text-white' : 'text-slate-400'} whitespace-nowrap`}>{NOTIF_BUCKET_LABEL[b]}</span>
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
          <div className="fixed left-[17rem] top-20 w-[380px] max-h-[75vh] overflow-y-auto bg-white border border-gray-300 rounded-xl shadow-2xl z-50 text-slate-900">
            <div className="sticky top-0 bg-white border-b border-gray-200">
              <div className="flex items-center px-4 pt-2.5 text-sm font-bold">
                알림 <span className="ml-auto text-[11px] font-normal text-gray-500">{seenAt ? `마지막 확인 ${timeLabel(seenAt)}` : ''}</span>
              </div>
              <div className="flex gap-1 px-3 pt-2 pb-2 overflow-x-auto">
                {tabs.map(t => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`px-2.5 py-1 rounded-full text-xs whitespace-nowrap border ${tab === t ? 'bg-slate-900 text-white border-slate-900' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                    {tabLabel(t)} <span className={`tabular-nums ${tab === t ? 'text-slate-300' : tabCount(t) > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{tabCount(t)}</span>
                  </button>
                ))}
              </div>
            </div>
            {list.length === 0 ? (
              <p className="px-4 py-8 text-sm text-gray-400 text-center">{tab === 'all' ? '확인할 알림이 없습니다.' : `${tabLabel(tab)} 알림이 없습니다.`}</p>
            ) : groups.map(g => {
              const sub = list.filter(i => i.group === g)
              if (!sub.length) return null
              return (
                <div key={g}>
                  <p className="px-4 pt-2.5 pb-1 text-[10.5px] text-gray-400 uppercase tracking-wide">{NOTIF_GROUP_LABEL[g]}</p>
                  {sub.map(i => {
                    const seen = !!seenAt && !!i.at && i.at <= seenAt
                    return (
                      <Link key={i.key} href={i.href} onClick={() => setTab(null)}
                        className="grid grid-cols-[8px_1fr_auto] gap-2.5 px-4 py-2 border-b border-gray-50 hover:bg-gray-50 items-start">
                        <span className={`w-2 h-2 rounded-full mt-1.5 ${DOT[i.tone]}`} />
                        <span className="min-w-0">
                          <span className={`block text-[13px] ${seen ? 'text-gray-600' : 'font-semibold text-gray-900'}`}>{i.title}</span>
                          {i.detail && <span className="block text-[11px] text-gray-500 truncate">{i.detail}</span>}
                        </span>
                        <span className="text-[10.5px] text-gray-400 whitespace-nowrap pt-0.5">{timeLabel(i.at)}</span>
                      </Link>
                    )
                  })}
                </div>
              )
            })}
            <div className="flex items-center px-4 py-2 bg-gray-50 text-[11px] text-gray-500">
              <button onClick={() => { onSeen(); setTab(null) }} className="hover:text-gray-800 underline">모두 확인함으로 표시</button>
              <span className="ml-auto" title={live ? '업무 요청 변경은 즉시 반영됩니다. 폴링은 안전망.' : '실시간 신호 연결 전 — 폴링으로 갱신'}>{live ? '즉시 갱신 연결됨 · ' : ''}{Math.round(NOTIF_POLL_MS / 1000)}초마다 갱신</span>
            </div>
          </div>
        </>
      )}
    </>
  )
}

export function NotificationToasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  const router = useRouter()
  if (!toasts.length) return null
  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2 w-[320px]">
      {toasts.map(t => (
        <div key={t.id} className="bg-slate-900 text-white rounded-xl shadow-2xl px-4 py-3 text-sm">
          <div className="flex items-start gap-2">
            <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${DOT[t.item.tone]}`} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t.item.title}</p>
              {t.item.detail && <p className="text-xs text-slate-300 mt-0.5 truncate">{t.item.detail}</p>}
            </div>
            <button onClick={() => onDismiss(t.id)} className="text-slate-400 hover:text-white text-xs leading-none" title="닫기">✕</button>
          </div>
          <div className="flex gap-1.5 mt-2.5">
            <button onClick={() => { onDismiss(t.id); router.push(t.item.href) }} className="px-2.5 py-1 rounded-md bg-white text-slate-900 text-xs font-semibold">열기</button>
            <button onClick={() => onDismiss(t.id)} className="px-2.5 py-1 rounded-md bg-white/10 text-xs">나중에</button>
          </div>
        </div>
      ))}
    </div>
  )
}

// 로그인 직후 "확인할 것" — 업무 선택(dark)·내 대시보드(light). 자체 1회 조회. 0건이면 렌더하지 않는다.
export function TodoPanel({ variant, data }: { variant: 'dark' | 'light'; data: NotifData | null }) {
  if (!data || data.items.length === 0) return null
  const dark = variant === 'dark'
  const pill = (i: NotifItem) => i.tone === 'red' ? 'bg-red-500 text-white' : i.tone === 'amber' ? 'bg-amber-400 text-slate-900' : i.tone === 'blue' ? 'bg-blue-500 text-white' : 'bg-slate-300 text-slate-800'
  return (
    <div className={`${dark ? 'bg-white/5 border border-slate-700 text-slate-100' : 'bg-white border border-gray-200 text-gray-900'} rounded-xl px-4 py-3 text-left`}>
      <div className="flex items-center text-sm font-bold">
        확인할 것
        <span className={`ml-auto flex items-center gap-2 text-[11px] font-normal ${dark ? 'text-slate-400' : 'text-gray-500'}`}>
          {data.count > 0 && <BucketPills data={data} tone={dark ? 'dark' : 'light'} />}{timeLabel(data.at)} 기준
        </span>
      </div>
      <ul className="mt-2">
        {data.items.map(i => (
          <li key={i.key} className={`flex items-center gap-2.5 py-1.5 text-[13px] border-t ${dark ? 'border-slate-800' : 'border-gray-100'}`}>
            <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none ${pill(i)}`}>{i.count}</span>
            <span className="truncate">{i.title.replace(/\s\d+건$/, '')}</span>
            <Link href={i.href} className={`ml-auto text-[11px] whitespace-nowrap hover:underline ${dark ? 'text-sky-300' : 'text-blue-600'}`}>바로가기 →</Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
