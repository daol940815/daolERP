'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

// 주문 상세 › 담당자(거래처) — 주문에 적힌 표기는 원본 그대로, 옆에 고객코드 + 누르면 지금 정보 카드
// (2026-11-13 사용자 승인, 시안 docs/mockups/주문상세_담당자연결_시안.html 탭 1 · 2 · 3)
interface Card {
  contact_id: string; name: string; code: string | null; phone: string | null; tel: string | null
  title_at_order: string | null
  current: { vendor_id: string; vendor_name: string; title: string | null; staff_name: string | null; title_changed_at: string | null }[]
  order_count: number; last_order_date: string | null
}

export default function ContactChip({ label, contactId, orderId }: { label: string; contactId: string | null; orderId: string }) {
  const [card, setCard] = useState<Card | null>(null)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contactId) return
    let alive = true
    fetch(`/api/orders-portal/contact-card?contact_id=${contactId}&order_id=${orderId}`)
      .then(r => r.ok ? r.json() : null).then(j => { if (alive && j) setCard(j) }).catch(() => {})
    return () => { alive = false }
  }, [contactId, orderId])
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // 인물 연결이 없는 주문 (예전 업로드 등) — 글자만
  if (!contactId) {
    return (
      <span>
        {label || '-'}
        {label && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[0.625rem] align-middle" title="이 주문은 담당자 인물과 연결되어 있지 않습니다 (예전 업로드 주문)">인물 연결 없음</span>}
      </span>
    )
  }
  const cur = card?.current[0]
  return (
    <div ref={box} className="relative inline-block">
      <button type="button" onClick={() => setOpen(o => !o)} className="text-blue-700 hover:underline text-left">{label || '-'}</button>
      {card?.code && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[0.625rem] font-mono align-middle" title="고객코드 — 같으면 같은 사람">{card.code}</span>}
      {open && card && (
        <div className="absolute z-20 left-0 top-full mt-1.5 w-80 bg-white border border-gray-300 rounded-xl shadow-xl p-3 text-xs">
          <div className="flex items-center justify-between mb-1.5">
            <b className="text-sm text-gray-900">{card.name}</b>
            {card.code && <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[0.625rem] font-mono">{card.code}</span>}
          </div>
          <Row k="이 주문 당시" v={card.title_at_order ?? '(직함 없음)'} />
          {card.current.length ? card.current.map(c => (
            <Row key={c.vendor_id} k="현재" v={<>
              {c.vendor_name} · <b>{c.title ?? '(직함 없음)'}</b>
              {c.title_changed_at && <span className="ml-1 px-1 rounded bg-amber-100 text-amber-800 text-[0.625rem] font-semibold">{c.title_changed_at.slice(5)} 변경</span>}
            </>} />
          )) : <Row k="현재" v={<span className="text-red-600">소속 없음</span>} />}
          <Row k="핸드폰 · 유선" v={[card.phone, card.tel].filter(Boolean).join(' · ') || '-'} />
          <Row k="다올 담당" v={cur?.staff_name ?? '-'} />
          <Row k="이 고객의 주문" v={`${card.order_count}건${card.last_order_date ? ` · 최근 ${card.last_order_date}` : ''}`} />
          <div className="flex justify-end gap-3 mt-2">
            <Link href={`/sales-hub/contacts/${card.contact_id}`} className="text-blue-700 hover:underline">담당자 상세</Link>
            {cur && <Link href={`/sales-hub/${cur.vendor_id}`} className="text-blue-700 hover:underline">매출처 상세</Link>}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-gray-400 shrink-0">{k}</span>
      <span className="text-right text-gray-800">{v}</span>
    </div>
  )
}
