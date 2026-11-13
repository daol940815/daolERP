'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { CardOrderState } from '@/lib/card-order-match.server'

// 카드 결제 1건을 주문에 배분하는 모달 (2026-11-13 승인 시안). 자동 매칭 없음 — 체크 + 금액 입력으로 사람이 배분.
// 저장은 교체: 체크를 풀면 해제된다. 이 매칭은 ERP 미수(수금) 기준이고 카드사 정산 입금은 통장에서 따로 확정한다.

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
const num = (s: string) => Number(String(s).replace(/[^0-9]/g, '')) || 0

export default function CardOrderMatchModal({ saleId, onClose, onSaved }: {
  saleId: string
  onClose: () => void
  onSaved: (saleId: string, count: number, amount: number) => void
}) {
  const [state, setState] = useState<CardOrderState | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [mode, setMode] = useState<'vendor' | 'all'>('vendor')
  const [q, setQ] = useState('')
  const [alloc, setAlloc] = useState<Record<string, string>>({})   // order_id → 금액 문자열 (체크 = 키 존재)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (query?: string) => {
    setLoading(true); setErr(null)
    const p = new URLSearchParams(); if (query) p.set('q', query)
    const res = await fetch(`/api/card-sales/${saleId}/order-match?${p}`, { cache: 'no-store' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(json.error ?? '조회 실패'); setLoading(false); return }
    const st = json as CardOrderState
    setState(st)
    // 현재 배분을 체크·금액 채운 상태로 (처음 열 때만)
    setAlloc(prev => Object.keys(prev).length ? prev : Object.fromEntries(st.current.map(m => [m.order_id, String(m.amount)])))
    setLoading(false)
  }, [saleId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const sale = state?.sale
  const sum = Object.values(alloc).reduce((s, v) => s + num(v), 0)
  const over = sale ? sum > sale.net : false
  const cands = state?.candidates ?? []
  // 현재 배분됐지만 후보 목록(검색 결과)에 없는 주문도 체크 상태로 보이게
  const extra = (state?.current ?? []).filter(m => !cands.some(c => c.id === m.order_id))

  const toggle = (id: string, defaultAmt: number) => setAlloc(a => {
    const n = { ...a }
    if (id in n) delete n[id]
    else n[id] = String(Math.max(0, Math.min(defaultAmt, (sale?.net ?? 0) - Object.values(n).reduce((s, v) => s + num(v), 0))))
    return n
  })

  const save = async () => {
    if (!sale) return
    setBusy(true); setErr(null)
    const allocations = Object.entries(alloc).map(([order_id, v]) => ({ order_id, amount: num(v) })).filter(a => a.amount > 0)
    const res = await fetch(`/api/card-sales/${saleId}/order-match`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allocations }) })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setErr(json.error ?? '저장 실패'); return }
    const st = json.state as CardOrderState | null
    onSaved(saleId, st?.current.length ?? allocations.length, st?.sale.allocated ?? allocations.reduce((s, a) => s + a.amount, 0))
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="font-bold text-gray-900">
              주문 매칭 — 카드 결제 {sale ? `${sale.tx_date}${sale.tx_time ? ' ' + sale.tx_time.slice(0, 5) : ''} · ${sale.acquirer ?? ''} ${sale.card_number ?? ''} · ${won(sale.amount)}` : ''}
              {sale && sale.cancel_amount > 0 && <span className="text-xs font-normal text-red-600 ml-1">취소 −{won(sale.cancel_amount)} → 순액 {won(sale.net)}</span>}
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          {sale && (
            <p className="text-xs text-gray-500 mt-1">
              거래처 <b>{sale.vendor_name ?? '(없음 — 전체 주문에서 고르면 그 주문의 매출처가 연결되고 카드번호가 학습됩니다)'}</b> ·
              배분 합 <b className={`tabular-nums ${over ? 'text-red-600' : sum === sale.net ? 'text-emerald-700' : ''}`}>{won(sum)}</b> / 순액 {won(sale.net)}
              {over && <span className="text-red-600"> — 순액을 넘어 저장할 수 없습니다</span>}
              {sale.over_allocated && !over && <span className="text-red-600"> · 현재 저장된 배분이 순액을 넘어 있습니다(취소 후). 금액을 줄여 저장하세요.</span>}
            </p>
          )}
          <p className="text-[0.6875rem] text-gray-400 mt-1">ERP 미수(수금) 기준 매칭입니다. 카드사 정산 입금은 통장 내역에서 매출채권 회수로 따로 확정합니다.</p>
        </div>

        <div className="px-5 py-3 overflow-auto flex-1 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
            <button onClick={() => { setMode('vendor'); setQ(''); load() }} className={`px-2 py-1 rounded-full border ${mode === 'vendor' ? 'bg-slate-900 border-slate-900 text-white' : 'border-gray-300 text-gray-600'}`}>이 매출처 주문</button>
            <button onClick={() => setMode('all')} className={`px-2 py-1 rounded-full border ${mode === 'all' ? 'bg-slate-900 border-slate-900 text-white' : 'border-gray-300 text-gray-600'}`}>전체 주문 검색</button>
            {mode === 'all' && (<>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="주문번호 · 업체 · 지점" className="border border-gray-300 rounded px-2 py-1 w-48"
                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) load(q) }} />
              <button onClick={() => load(q)} className="px-2.5 py-1 border border-gray-300 rounded hover:bg-gray-50">찾기</button>
            </>)}
            <span className="text-gray-400">정렬: 금액 일치 → 결제일 −7 ~ +60일 → 최근 주문</span>
          </div>

          {loading ? <p className="text-gray-400 py-6 text-center text-xs">조회 중...</p> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-400 border-b border-gray-200">
                <th className="py-1.5 pr-2 w-6"></th><th className="py-1.5 pr-3 font-medium">주문번호</th><th className="py-1.5 pr-3 font-medium">주문일</th><th className="py-1.5 pr-3 font-medium">업체 · 담당</th>
                <th className="py-1.5 pr-3 font-medium text-right">주문액</th><th className="py-1.5 pr-3 font-medium text-right">남은 미수</th><th className="py-1.5 pr-3 font-medium text-right">배분 금액</th><th className="py-1.5 font-medium">근거</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {extra.map(m => (
                  <tr key={m.order_id} className="bg-sky-50/50">
                    <td className="py-1.5 pr-2"><input type="checkbox" checked={m.order_id in alloc} onChange={() => toggle(m.order_id, m.amount)} /></td>
                    <td className="py-1.5 pr-3"><Link href={`/orders?c=order_no:${encodeURIComponent(m.order_no)}&from=&to=`} className="text-blue-700 hover:underline" title="주문 현황에서 열기">#{m.order_no}</Link></td>
                    <td className="py-1.5 pr-3 tabular-nums">{m.order_date ?? '-'}</td><td className="py-1.5 pr-3">{m.customer_name}</td>
                    <td className="py-1.5 pr-3 text-right text-gray-400">-</td><td className="py-1.5 pr-3 text-right text-gray-400">-</td>
                    <td className="py-1.5 pr-3 text-right">{m.order_id in alloc && <input value={alloc[m.order_id]} onChange={e => setAlloc(a => ({ ...a, [m.order_id]: e.target.value }))} className="border border-gray-300 rounded px-2 py-0.5 w-28 text-right tabular-nums" />}</td>
                    <td className="py-1.5 text-gray-500">현재 배분됨 (목록 밖 주문)</td>
                  </tr>
                ))}
                {cands.map(c => {
                  const on = c.id in alloc
                  const disabled = c.remaining <= 0 && !on
                  return (
                    <tr key={c.id} className={`${on ? 'bg-sky-50/50' : disabled ? 'opacity-50' : 'hover:bg-gray-50'}`}>
                      <td className="py-1.5 pr-2"><input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(c.id, Math.min(c.remaining, sale?.remaining ?? c.remaining) || c.remaining)} /></td>
                      <td className="py-1.5 pr-3 whitespace-nowrap"><Link href={`/orders?c=order_no:${encodeURIComponent(c.order_no)}&from=&to=`} className="text-blue-700 hover:underline" title="주문 현황에서 열기">#{c.order_no}</Link></td>
                      <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{c.order_date}</td>
                      <td className="py-1.5 pr-3 truncate max-w-[200px]">{c.customer_name}{c.staff_name ? <span className="text-gray-400"> · {c.staff_name}</span> : null}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{c.net_amount.toLocaleString('ko-KR')}</td>
                      <td className={`py-1.5 pr-3 text-right tabular-nums ${c.remaining > 0 ? 'text-red-600' : 'text-gray-400'}`}>{c.remaining.toLocaleString('ko-KR')}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {on ? <input value={alloc[c.id]} onChange={e => setAlloc(a => ({ ...a, [c.id]: e.target.value }))}
                          className={`border rounded px-2 py-0.5 w-28 text-right tabular-nums ${num(alloc[c.id]) > c.remaining ? 'border-red-400' : 'border-gray-300'}`} /> : <span className="text-gray-300">-</span>}
                      </td>
                      <td className={`py-1.5 ${c.score >= 50 ? 'text-emerald-700' : 'text-gray-500'}`}>{c.reason}</td>
                    </tr>
                  )
                })}
                {!cands.length && !extra.length && <tr><td colSpan={8} className="py-6 text-center text-gray-400">{mode === 'all' ? '검색 결과가 없습니다.' : sale?.vendor_id ? '이 매출처에 미수가 남은 주문이 없습니다. 전체 주문 검색으로 찾아보세요.' : '거래처가 없는 카드입니다. 전체 주문 검색으로 주문을 고르면 거래처가 연결됩니다.'}</td></tr>}
              </tbody>
            </table>
          )}
          {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between">
          <Link href={`/erp-matching?depositId=card:${saleId}`} className="text-xs text-gray-500 hover:underline">입금 매칭 화면에서 열기 →</Link>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">닫기</button>
            <button onClick={save} disabled={busy || over || !sale} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40">
              {busy ? '저장 중...' : Object.keys(alloc).length ? '배분 저장' : '배분 전부 해제'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
