'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CashReceipt, CashReceiptPayment } from '@/types/cash-receipt'

// 현금영수증(매출 발행) 입금 연결 모달 (425, 2026-11-13 승인 시안) — 계산서 결제연결 모달과 같은 흐름.
// 추천 후보(발행일 ±7일 · 남은 금액 ≥ 잔액 · 계산서·다른 영수증 미연결) + 직접 찾기(기간·검색어). 연결 금액은 고칠 수 있다(분할·합산).

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

interface Candidate {
  id: string; tx_date: string; description: string | null; counterparty_name: string | null; account_alias: string | null
  amount_in: number; remain: number; lag: number; reason: string; score: number
}

export default function ReceiptMatchModal({ receipt, onClose, onChanged }: {
  receipt: CashReceipt
  onClose: () => void
  onChanged: (payments: CashReceiptPayment[]) => void
}) {
  const [payments, setPayments] = useState<CashReceiptPayment[]>(receipt.payments ?? [])
  const [cands, setCands] = useState<Candidate[]>([])
  const [remain, setRemain] = useState(0)
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [manual, setManual] = useState(false)
  const [mFrom, setMFrom] = useState('')
  const [mTo, setMTo] = useState('')
  const [mQ, setMQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async (opts?: { from?: string; to?: string; q?: string }) => {
    setLoading(true); setErr(null)
    const p = new URLSearchParams({ candidates: '1' })
    if (opts?.from) p.set('from', opts.from)
    if (opts?.to) p.set('to', opts.to)
    if (opts?.q) p.set('q', opts.q)
    const res = await fetch(`/api/cash-receipts/${receipt.id}/payments?${p}`, { cache: 'no-store' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(json.error ?? '후보 조회 실패'); setLoading(false); return }
    setCands(json.candidates ?? [])
    setRemain(json.receipt?.remain ?? 0)
    const first = (json.candidates ?? [])[0] as Candidate | undefined
    if (first && first.remain > 0) { setPicked(first.id); setAmount(String(Math.min(first.remain, json.receipt?.remain ?? 0))) }
    else { setPicked(null); setAmount('') }
    setLoading(false)
  }, [receipt.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const pick = (c: Candidate) => { setPicked(c.id); setAmount(String(Math.min(c.remain, remain))) }

  const link = async () => {
    if (!picked) return
    const amt = Number(amount.replace(/[^0-9]/g, ''))
    if (!amt) { setErr('연결 금액을 입력하세요.'); return }
    setBusy(true); setErr(null)
    const res = await fetch(`/api/cash-receipts/${receipt.id}/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionId: picked, amount: amt }) })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setErr(json.error ?? '연결 실패'); return }
    setPayments(json.data ?? []); onChanged(json.data ?? [])
    await load(manual ? { from: mFrom, to: mTo, q: mQ } : undefined)
  }
  const unlink = async (paymentId: string) => {
    setBusy(true); setErr(null)
    const res = await fetch(`/api/cash-receipts/${receipt.id}/payments`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentId }) })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setErr(json.error ?? '해제 실패'); return }
    setPayments(json.data ?? []); onChanged(json.data ?? [])
    await load(manual ? { from: mFrom, to: mTo, q: mQ } : undefined)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="font-bold text-gray-900">입금 연결 — 현금영수증 {receipt.tx_date} · {won(Math.abs(receipt.amount))}
              <span className="text-xs font-normal text-gray-400 ml-1">({receipt.issue_type ?? '-'} · {receipt.purpose_type ?? '-'}{receipt.counterparty_name ? ` · ${receipt.counterparty_name}` : ''})</span>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            남은 금액 <b className="tabular-nums">{won(remain)}</b>. 후보는 발행일 ±7일 안의 입금 중 남은 금액이 잔액 이상이고 계산서·다른 영수증에 쓰이지 않은 것. 이름이 맞으면 위로 올립니다.
          </p>
        </div>

        <div className="px-5 py-3 overflow-auto flex-1 text-sm">
          {payments.length > 0 && (
            <div className="mb-3">
              <div className="text-xs text-gray-400 mb-1">연결된 입금</div>
              <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
                {payments.map(p => (
                  <li key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <span className="tabular-nums text-gray-500">{p.transaction?.tx_date}</span>
                    <span className="text-gray-400">{p.transaction?.account_alias ?? ''}</span>
                    <span className="flex-1 truncate">{p.transaction?.counterparty_name || p.transaction?.description}</span>
                    <span className="font-semibold tabular-nums">{won(p.amount)}</span>
                    <span className="text-gray-400">{p.matched_by === 'auto' ? '자동' : '수동'}</span>
                    <button onClick={() => unlink(p.id)} disabled={busy} className="text-gray-400 hover:text-red-600" title="연결 해제">✕</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between mb-1">
            <div className="text-xs text-gray-400">{manual ? '직접 찾기 결과' : '추천 후보'}</div>
            <button onClick={() => { setManual(m => !m); if (manual) load() }} className="text-xs text-blue-600 hover:underline">{manual ? '추천 후보로' : '직접 찾기'}</button>
          </div>
          {manual && (
            <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
              <input type="date" value={mFrom} onChange={e => setMFrom(e.target.value)} className="border border-gray-300 rounded px-2 py-1" />
              <span className="text-gray-400">~</span>
              <input type="date" value={mTo} onChange={e => setMTo(e.target.value)} className="border border-gray-300 rounded px-2 py-1" />
              <input value={mQ} onChange={e => setMQ(e.target.value)} placeholder="적요 · 보낸분 · 금액" className="border border-gray-300 rounded px-2 py-1 w-44"
                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) load({ from: mFrom, to: mTo, q: mQ }) }} />
              <button onClick={() => load({ from: mFrom, to: mTo, q: mQ })} className="px-2.5 py-1 border border-gray-300 rounded hover:bg-gray-50">검색</button>
            </div>
          )}
          {loading ? <p className="text-gray-400 py-6 text-center text-xs">후보 조회 중...</p> : cands.length === 0 ? (
            <p className="text-gray-400 py-6 text-center text-xs">조건에 맞는 입금이 없습니다. 직접 찾기로 기간을 넓혀 보세요.</p>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-400 border-b border-gray-200">
                <th className="py-1.5 pr-2 w-6"></th><th className="py-1.5 pr-3 font-medium">입금일</th><th className="py-1.5 pr-3 font-medium">계좌</th><th className="py-1.5 pr-3 font-medium">적요 / 보낸분</th>
                <th className="py-1.5 pr-3 font-medium text-right">입금액</th><th className="py-1.5 pr-3 font-medium text-right">남음</th><th className="py-1.5 pr-3 font-medium text-right">연결 금액</th><th className="py-1.5 font-medium">근거</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {cands.map(c => {
                  const on = picked === c.id
                  return (
                    <tr key={c.id} className={`${on ? 'bg-emerald-50/60' : 'hover:bg-gray-50'} ${c.remain <= 0 ? 'opacity-50' : 'cursor-pointer'}`} onClick={() => c.remain > 0 && pick(c)}>
                      <td className="py-1.5 pr-2"><input type="radio" checked={on} disabled={c.remain <= 0} onChange={() => pick(c)} /></td>
                      <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{c.tx_date}</td>
                      <td className="py-1.5 pr-3 text-gray-500 whitespace-nowrap">{c.account_alias ?? '-'}</td>
                      <td className="py-1.5 pr-3 truncate max-w-[220px]">{c.counterparty_name || c.description || '-'}{c.counterparty_name && c.description && c.counterparty_name !== c.description ? <span className="text-gray-400"> · {c.description}</span> : null}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{c.amount_in.toLocaleString('ko-KR')}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-gray-500">{c.remain.toLocaleString('ko-KR')}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {on ? <input value={amount} onChange={e => setAmount(e.target.value)} onClick={e => e.stopPropagation()}
                          className="border border-gray-300 rounded px-2 py-0.5 w-28 text-right tabular-nums" /> : <span className="text-gray-300">-</span>}
                      </td>
                      <td className="py-1.5 text-gray-500">{c.reason}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">닫기</button>
          <button onClick={link} disabled={busy || !picked || remain <= 0} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40">
            {busy ? '연결 중...' : remain <= 0 ? '전액 연결됨' : '연결'}
          </button>
        </div>
      </div>
    </div>
  )
}
