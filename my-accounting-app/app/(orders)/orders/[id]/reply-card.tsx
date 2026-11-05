'use client'

import { useState } from 'react'
import { requestNotifRefresh } from '@/lib/use-notif-refresh'

// 완료 회신 카드 (515, 2026-11-05 사용자 확정 — 시안 docs/mockups/완료회신_시안.html A)
// 주문 · 발주를 처리한 직원이 요청자 · 상담자에게 결과를 회신한다. 회신해야 완료.
//  - 처리 결과 요약은 주문 · 발주서에서 화면 표시 시 계산 (저장 안 함)
//  - 회신은 이력으로 쌓이고 최신 회신이 상태. 주문 수정 권한자 누구나 회신 가능
//  - 처리 불가 회신은 주문을 자동 취소하지 않는다

export type ReplyResult = 'done' | 'changed' | 'unable'
export interface ReplyData {
  target: boolean
  ready: boolean
  state: 'waiting' | ReplyResult | null
  recipients: { id: string; name: string }[]
  entrant_name: string | null
  replies: { id: string; result: ReplyResult; memo: string | null; employee_name: string | null; created_at: string }[]
  pos: { po_no: string; vendor_name: string; sent_at: string | null }[]
  can_reply: boolean
}

const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  waiting: { label: '회신 대기', cls: 'bg-orange-50 text-orange-700 border border-orange-200' },
  done: { label: '완료', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  changed: { label: '완료(변경 있음)', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  unable: { label: '처리 불가', cls: 'bg-red-50 text-red-700 border border-red-200' },
}
const DOT: Record<ReplyResult, string> = { done: 'bg-emerald-500', changed: 'bg-amber-500', unable: 'bg-red-500' }
const RESULTS: [ReplyResult, string][] = [['done', '완료'], ['changed', '완료(변경 있음)'], ['unable', '처리 불가']]

const won = (n: number) => (n ?? 0).toLocaleString('ko-KR')
const when = (iso: string) => {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
}

export default function ReplyCard({ orderId, reply, summary, onSaved }: {
  orderId: string
  reply: ReplyData
  summary: { orderNo: string; where: string; customer: string; total: number; ship: string }
  onSaved: () => void
}) {
  const [result, setResult] = useState<ReplyResult>('done')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(reply.state === 'waiting')

  if (!reply.target) return null
  const badge = STATE_BADGE[reply.state ?? 'waiting']
  const unsent = reply.pos.filter(p => !p.sent_at)

  const submit = async () => {
    setErr(null)
    if (result !== 'done' && !memo.trim()) {
      setErr(result === 'unable' ? '처리 불가 사유를 적어주세요.' : '무엇이 바뀌었는지 회신 메모에 적어주세요.')
      return
    }
    if (result !== 'unable' && unsent.length
      && !window.confirm(`아직 발송 안 된 발주서가 ${unsent.length}건 있습니다 (${unsent.map(p => p.vendor_name).join(', ')}). 그래도 회신할까요?`)) return
    setBusy(true)
    const res = await fetch(`/api/orders-portal/orders/${orderId}/reply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result, memo: memo.trim() || null }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setErr(json.error ?? '회신 실패'); return }
    setMemo(''); setResult('done'); setOpen(false)
    requestNotifRefresh()
    onSaved()
  }

  return (
    <div className={`bg-white rounded-xl p-4 mt-3 border ${reply.state === 'waiting' ? 'border-orange-300' : 'border-gray-200'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-sm font-bold text-gray-900">완료 회신</div>
        <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${badge.cls}`}>{badge.label}</span>
        <span className="ml-auto text-xs text-gray-400">
          받는 사람: <span className="text-gray-700">{reply.recipients.map(r => r.name).join(' · ') || '-'}</span>
          {reply.entrant_name && <span> · 입력 {reply.entrant_name}</span>}
        </span>
      </div>

      {/* 처리 결과 (자동) */}
      <div className="mt-2.5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs leading-relaxed text-gray-700">
        <div><b className="text-gray-900">처리 결과 (자동)</b> <span className="text-gray-400">— 주문 · 발주서에서 계산</span></div>
        <div>주문 {summary.orderNo} · {summary.where}{summary.customer ? ` · ${summary.customer}` : ''} · <b className="tabular-nums">{won(summary.total)}원</b></div>
        <div className="flex flex-wrap items-center gap-1">
          <span>발주:</span>
          {!reply.pos.length ? <span className="text-gray-400">발주서 없음</span> : reply.pos.map(p => (
            <span key={p.po_no} className="inline-flex items-center gap-1 mr-1.5">
              {p.vendor_name}
              <span className={`px-1.5 py-0.5 rounded text-[0.625rem] font-medium ${p.sent_at ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
                {p.sent_at ? `발송 ${when(p.sent_at)}` : '미발송'}
              </span>
            </span>
          ))}
        </div>
        {summary.ship && <div>배송지: {summary.ship}</div>}
      </div>

      {/* 회신 폼 — 주문 수정 권한자 누구나. 회신 후에도 추가 회신 가능(배송 출발 등) */}
      {reply.can_reply && (open ? (
        <div className="mt-3">
          <div className="flex flex-wrap gap-1.5">
            {RESULTS.map(([k, l]) => (
              <button key={k} type="button" onClick={() => setResult(k)}
                className={`px-3 py-1.5 rounded-lg text-xs border ${result === k
                  ? (k === 'unable' ? 'border-red-500 bg-red-50 text-red-700 font-semibold' : 'border-slate-900 bg-slate-50 text-gray-900 font-semibold')
                  : 'border-gray-300 text-gray-600 hover:border-gray-400'}`}>
                {l}
              </button>
            ))}
          </div>
          <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={3}
            placeholder={result === 'done' ? '회신 메모 (선택) — 예: 발주 완료, 11/7 도착 예정' : result === 'changed' ? '무엇이 바뀌었는지 (필수) — 예: A품목 품절로 B로 대체, 고객 확인 완료' : '처리 불가 사유 (필수)'}
            className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          {result === 'unable' && (
            <div className="mt-1 text-[0.6875rem] text-red-600">처리 불가 회신은 주문을 자동으로 취소하지 않습니다. 취소가 필요하면 위의 주문 취소로 따로 처리하세요.</div>
          )}
          {err && <div className="mt-1.5 text-xs text-red-600">{err}</div>}
          <div className="mt-2 flex justify-end gap-2">
            {reply.replies.length > 0 && (
              <button type="button" onClick={() => { setOpen(false); setErr(null) }} className="px-3 py-1.5 text-xs text-gray-500">닫기</button>
            )}
            <button type="button" onClick={submit} disabled={busy}
              className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-sm disabled:opacity-50">
              {busy ? '보내는 중...' : '회신 보내기'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5">
          <button type="button" onClick={() => setOpen(true)}
            className="px-3 py-1 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
            {reply.replies.length ? '추가 회신' : '회신 쓰기'}
          </button>
        </div>
      ))}

      {/* 회신 이력 — 지우거나 덮어쓰지 않음 */}
      {reply.replies.length > 0 && (
        <div className="mt-3 border-l-2 border-gray-200 ml-1.5 pl-3.5 space-y-2.5">
          {reply.replies.map(r => (
            <div key={r.id} className="relative text-xs leading-relaxed">
              <span className={`absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full ${DOT[r.result]}`} />
              <b className="text-gray-900">{STATE_BADGE[r.result].label}</b>
              <span className="text-gray-500"> · {r.employee_name ?? ''}</span>
              <span className="text-gray-400 ml-1">{when(r.created_at)}</span>
              {r.memo && <div className="text-gray-700 whitespace-pre-wrap">{r.memo}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
