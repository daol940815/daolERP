'use client'

// PC 알림 허용 안내 — 사이드바 알림 종 위에 한 번 뜬다 (업무요청 트랙 ⑦, 2026-11-03 사용자 결정 ④: 로그인 직후 1회 안내).
// 조건: 브라우저가 Web Push 를 지원하고 · 차단되어 있지 않고 · 이 브라우저에 아직 구독이 없고 · "나중에"(7일) 중이 아니고 · 서버에 VAPID 키가 있을 때.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { enablePush, laterActive, pushState, setLater } from '@/lib/push-client'

export default function PushBanner() {
  const [show, setShow] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (laterActive()) return
      const st = await pushState()
      if (st !== 'ready') return
      try {
        const res = await fetch('/api/push/subscriptions', { cache: 'no-store' })
        const j = await res.json()
        if (!alive || !res.ok || !j.configured || !j.linked) return
        setKey(j.vapidPublicKey ?? '')
        setShow(true)
      } catch { /* 안내 생략 */ }
    })()
    return () => { alive = false }
  }, [])

  if (!show) return null
  const allow = async () => {
    setBusy(true); setMsg(null)
    const err = await enablePush(key)
    setBusy(false)
    if (err) { setMsg(err); return }
    setMsg('허용됐습니다. 웹을 닫아도 알림이 뜹니다.')
    setTimeout(() => setShow(false), 2500)
  }
  const later = () => { setLater(); setShow(false) }

  return (
    <div className="mx-3 mb-2 px-3 py-2.5 rounded-lg bg-blue-950/60 border border-blue-800 text-[12px] leading-relaxed text-blue-100">
      <p>업무 요청 · 휴가 승인 알림을 <b>이 PC에서 바로</b> 받으시겠습니까? 웹페이지를 닫아도 알림이 뜹니다.</p>
      {msg && <p className={`mt-1.5 ${msg.startsWith('허용됐') ? 'text-emerald-300' : 'text-amber-300'}`}>{msg}</p>}
      <div className="flex items-center gap-2 mt-2">
        <button onClick={allow} disabled={busy} className="px-2.5 py-1 rounded bg-white text-slate-900 font-semibold text-[11px] hover:bg-blue-50 disabled:opacity-50">{busy ? '허용 중...' : '알림 허용'}</button>
        <button onClick={later} className="px-2.5 py-1 rounded border border-blue-700 text-blue-200 text-[11px] hover:bg-blue-900">나중에</button>
        <Link href="/me/profile?tab=notify" className="ml-auto text-[11px] text-blue-300 underline">설정</Link>
      </div>
    </div>
  )
}
