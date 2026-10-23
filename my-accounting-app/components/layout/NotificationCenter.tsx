'use client'

// 알림 센터 — 사이드바 종(건수) + 패널, 우하단 토스트. 데이터·폴링은 useNotifications(AreaSidebar가 소유).
// 종 숫자 = 해야 할 것 + 기다리는 것(결과 통지 제외, 2026-10-16 권장안 확정). 소리 없음.

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { NOTIF_GROUP_LABEL, type NotifData, type NotifGroup, type NotifItem } from '@/lib/notifications'
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

export function NotificationBell({ data, seenAt, onSeen }: { data: NotifData | null; seenAt: string | null; onSeen: () => void }) {
  const [open, setOpen] = useState(false)
  const count = data?.count ?? 0
  const items = data?.items ?? []
  const groups: NotifGroup[] = ['todo', 'waiting', 'info']
  return (
    <>
      <button onClick={() => setOpen(o => !o)}
        className={`mx-3 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors ${open ? 'bg-slate-800 border-slate-600 text-white' : 'border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
        <span>알림</span>
        {count > 0 ? <span className="ml-auto text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none bg-red-500 text-white">{count}</span>
          : <span className="ml-auto text-[10px] text-slate-500">없음</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed left-[17rem] top-20 w-[360px] max-h-[75vh] overflow-y-auto bg-white border border-gray-300 rounded-xl shadow-2xl z-50 text-slate-900">
            <div className="flex items-center px-4 py-2.5 border-b border-gray-200 text-sm font-bold">
              알림 <span className="ml-auto text-[11px] font-normal text-gray-500">{items.length ? `${items.length}건` : ''}{seenAt ? ` · 마지막 확인 ${timeLabel(seenAt)}` : ''}</span>
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-8 text-sm text-gray-400 text-center">확인할 알림이 없습니다.</p>
            ) : groups.map(g => {
              const list = items.filter(i => i.group === g)
              if (!list.length) return null
              return (
                <div key={g}>
                  <p className="px-4 pt-2.5 pb-1 text-[10.5px] text-gray-400 uppercase tracking-wide">{NOTIF_GROUP_LABEL[g]}</p>
                  {list.map(i => {
                    const seen = !!seenAt && !!i.at && i.at <= seenAt
                    return (
                      <Link key={i.key} href={i.href} onClick={() => setOpen(false)}
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
              <button onClick={() => { onSeen(); setOpen(false) }} className="hover:text-gray-800 underline">모두 확인함으로 표시</button>
              <span className="ml-auto">60초마다 갱신</span>
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
        확인할 것 <span className={`ml-auto text-[11px] font-normal ${dark ? 'text-slate-400' : 'text-gray-500'}`}>{data.count}건 · {timeLabel(data.at)} 기준</span>
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
