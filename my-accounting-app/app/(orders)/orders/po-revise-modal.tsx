'use client'

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { btnCls, fieldBox, tbl } from '@/components/ui/kit'
import type { RevisePlan } from '@/lib/po-revise'

// 발주서 '수정 내용 반영' 창 (519, 2026-11-27 — 시안 project-files mockups/발주서_수정반영_시안.html)
// 주문 상세 발주 칸 · 발송 페이지 공용. 규칙은 lib/po-revise.ts — 시스템은 짝을 추천만, 직원이 확인하고 반영한다.

const won = (n: number | null | undefined) => Math.round(n ?? 0).toLocaleString('ko-KR')
const kst = (iso: string) => new Date(iso).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})
const NONE = '__none__'

export default function PoReviseModal({ poId, onClose, onDone, sendHref }: {
  poId: string
  onClose: () => void
  onDone: (message: string) => void
  sendHref?: string          // 발송 기록이 없을 때 안내할 발송 페이지 주소 (발송 페이지 안에서 열면 생략)
}) {
  const [plan, setPlan] = useState<RevisePlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState<Record<string, string>>({})   // po_item_id → 주문 품목 id | NONE | ''
  const [adds, setAdds] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let alive = true
    fetch(`/api/orders-portal/purchase-orders/${poId}/revise`)
      .then(async res => {
        const json = await res.json()
        if (!alive) return
        if (!res.ok) { setError(json.error ?? '조회 실패'); return }
        const p = json as RevisePlan
        setPlan(p)
        setPick(Object.fromEntries(p.lines.filter(l => l.stale).map(l => [l.po_item_id, l.suggested ?? ''])))
      })
      .catch(() => { if (alive) setError('조회 실패') })
    return () => { alive = false }
  }, [poId])

  const stale = useMemo(() => plan?.lines.filter(l => l.stale) ?? [], [plan])
  const candById = useMemo(() => new Map((plan?.candidates ?? []).map(c => [c.id, c])), [plan])
  const chosen = new Set(Object.values(pick).filter(v => v && v !== NONE))
  const addable = (plan?.candidates ?? []).filter(c => !chosen.has(c.id))
  const unanswered = stale.filter(l => !pick[l.po_item_id]).length

  // 반영하면 바뀌는 합계 (미리 보기)
  const totalAfter = plan ? plan.lines.reduce((s, l) => {
    if (!l.stale) return s + l.purchase_total
    const v = pick[l.po_item_id]
    return s + (v && v !== NONE ? candById.get(v)?.purchase_total ?? 0 : 0)
  }, 0) + addable.filter(c => adds[c.id]).reduce((s, c) => s + c.purchase_total, 0) : 0

  async function submit() {
    if (!plan) return
    setBusy(true); setError(null)
    const res = await fetch(`/api/orders-portal/purchase-orders/${poId}/revise`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairs: stale.map(l => ({ po_item_id: l.po_item_id, order_item_id: pick[l.po_item_id] === NONE ? null : pick[l.po_item_id] })),
        add_item_ids: addable.filter(c => adds[c.id]).map(c => c.id),
      }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(json.error ?? '반영 실패'); return }
    onDone(`${plan.po.po_no} 수정 내용을 반영했습니다 — 발주서 합계 ${won(json.total_before)}원 → ${won(json.total_after)}원`)
  }

  const title = plan ? `수정 내용 반영 — ${plan.po.po_no} · ${plan.po.vendor_name}` : '수정 내용 반영'
  const canSubmit = !!plan && !!plan.basis && !busy && unanswered === 0 && (stale.length > 0 || addable.some(c => adds[c.id]))

  return (
    <Modal size="xl" title={title} onClose={onClose}
      desc="고친 내용을 업체에 다시 보낸 뒤에 씁니다. 발주서 줄을 바뀐 주문 품목에 다시 연결하고, 발주서에 적힌 수량 · 금액을 새 값으로 바꿉니다."
      footer={<>
        <span className="mr-auto self-center text-xs text-slate-600">주문 품목 · 매출 · 매입 집계는 바뀌지 않습니다. 발주서 연결과 발주서에 적힌 수량 · 금액만 바뀝니다.</span>
        <button onClick={onClose} className={btnCls('secondary', 'md')}>닫기</button>
        <button onClick={submit} disabled={!canSubmit} className={btnCls('primary', 'md')}>{busy ? '반영 중...' : '반영'}</button>
      </>}>
      {error && <div className="mb-3 px-3.5 py-2 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}
      {!plan && !error && <div className="text-sm text-slate-500">불러오는 중...</div>}
      {plan && (
        <div className="space-y-3">
          {plan.basis ? (
            <div className="px-3.5 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">
              <b>수정 뒤 발송 기록 있음</b> — {kst(plan.basis.sent_at)} {plan.basis.method === 'email' ? '메일 발송' : '수동 발송'}
              {plan.basis.sender_name ? ` · ${plan.basis.sender_name}` : ''}
              {plan.basis.attachment_names.length ? ` · 첨부 ${plan.basis.attachment_names.join(', ')}` : ''}
            </div>
          ) : (
            <div className="px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              주문 수정{plan.edited_at ? `(${kst(plan.edited_at)})` : ''} 뒤에 이 발주서를 보낸 기록이 없습니다. 업체가 아직 옛 내용을 알고 있을 수 있습니다.
              발송 페이지에서 수정본을 보내거나 &lsquo;수동 발송 기록&rsquo;(카카오톡 · 전화 · 쇼핑몰 구매 등)을 남긴 뒤 반영하세요.
              {sendHref && <a href={sendHref} className="ml-1.5 underline font-semibold">발송 페이지로</a>}
            </div>
          )}

          <div>
            <div className="text-sm font-bold text-slate-800 mb-1.5">바뀐 품목 — 발주서 줄을 새 주문 품목에 연결합니다</div>
            <div className="overflow-x-auto border border-slate-300 rounded-lg">
              <table className={tbl.table}>
                <thead><tr>
                  <th className={tbl.th}>발주서 줄</th>
                  <th className={tbl.th}>발주서에 적힌 내용</th>
                  <th className={tbl.th}>지금 주문 품목 (짝)</th>
                  <th className={tbl.th}>바뀌는 칸</th>
                  <th className={tbl.thNum}>발주서 금액</th>
                </tr></thead>
                <tbody>
                  {plan.lines.map(l => {
                    const v = pick[l.po_item_id]
                    const c = v && v !== NONE ? candById.get(v) : undefined
                    return (
                      <tr key={l.po_item_id} className={tbl.tr}>
                        <td className={tbl.td}>{l.line_no}</td>
                        <td className={tbl.td}>
                          <div className="font-semibold text-slate-900">{l.item_name ?? '-'} × {l.quantity}</div>
                          <div className="text-xs text-slate-500">단가 {won(l.purchase_price)}{l.stale ? ' · 주문에서 바뀐 줄' : ' · 바뀌지 않음'}</div>
                        </td>
                        <td className={tbl.td}>
                          {l.stale ? (
                            <>
                              <select value={v ?? ''} onChange={e => setPick(prev => ({ ...prev, [l.po_item_id]: e.target.value }))}
                                className={fieldBox({ kind: 'pick', size: 'sm' })}>
                                <option value="">-- 고르기 (같은 매입처의 미발주 품목) --</option>
                                {plan.candidates.filter(o => o.id === v || !chosen.has(o.id)).map(o => (
                                  <option key={o.id} value={o.id}>
                                    {o.line_no}줄 · {o.item_name ?? '-'} × {o.quantity}{o.id === l.suggested ? ` (추천 — ${l.suggest_reason})` : ''}
                                  </option>
                                ))}
                                <option value={NONE}>짝 없음 — 이 줄은 주문에서 빠짐</option>
                              </select>
                              {!l.suggested && <div className="mt-1 text-xs text-amber-700">추천할 짝을 찾지 못했습니다 — 직접 고르세요</div>}
                            </>
                          ) : <span className="text-slate-500">그대로</span>}
                        </td>
                        <td className={tbl.td}>
                          {l.stale
                            ? v === NONE ? <span className="text-red-600 font-semibold">발주서에서 빠짐</span>
                              : c ? <span className="text-amber-700 font-semibold">{c.diff[l.po_item_id]}</span>
                              : <span className="text-slate-500">-</span>
                            : <span className="text-slate-500">-</span>}
                        </td>
                        <td className={tbl.tdNum}>
                          {l.stale && (v === NONE || c) ? (
                            <>
                              <div className="text-slate-500 line-through">{won(l.purchase_total)}</div>
                              <div>{v === NONE ? 0 : won(c?.purchase_total)}</div>
                            </>
                          ) : won(l.purchase_total)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {addable.length > 0 && (
            <div>
              <div className="text-sm font-bold text-slate-800 mb-1.5">같은 매입처의 아직 발주 안 된 품목</div>
              <div className="overflow-x-auto border border-slate-300 rounded-lg">
                <table className={tbl.table}>
                  <thead><tr>
                    <th className={tbl.th}>이 발주서에</th><th className={tbl.th}>품목</th>
                    <th className={tbl.thNum}>수량</th><th className={tbl.thNum}>발주서 금액</th>
                  </tr></thead>
                  <tbody>
                    {addable.map(c => (
                      <tr key={c.id} className={tbl.tr}>
                        <td className={tbl.td}>
                          <label className="flex items-center gap-1.5 text-sm">
                            <input type="checkbox" checked={!!adds[c.id]} onChange={e => setAdds(prev => ({ ...prev, [c.id]: e.target.checked }))} />
                            함께 넣기
                          </label>
                        </td>
                        <td className={tbl.td}>{c.line_no}줄 · {c.item_name ?? '-'}</td>
                        <td className={tbl.tdNum}>{c.quantity}</td>
                        <td className={tbl.tdNum}>{won(c.purchase_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-1 text-xs text-slate-600">수정본에 이 품목도 넣어 보냈으면 체크하세요. 따로 보낼 거면 비워 두고 주문 상세에서 새 발주서를 만듭니다.</div>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap text-sm px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-slate-700">반영하면 발주서 합계</span>
            <span className="tabular-nums"><span className="text-slate-500 line-through">{won(plan.po.total_amount)}</span> → <b>{won(totalAfter)}원</b></span>
            {unanswered > 0 && <span className="text-amber-700">짝을 고르지 않은 줄 {unanswered}개</span>}
          </div>
        </div>
      )}
    </Modal>
  )
}
