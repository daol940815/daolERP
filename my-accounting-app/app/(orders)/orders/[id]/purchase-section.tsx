'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PoDetail from '../po-detail'

// 주문 상세의 발주 섹션 (3단계, 시안 v3) — direct 주문 전용, 전 직원 사용 가능.
// 매입처별 미발주 품목을 골라 발주서를 만들고, 엑셀 다운로드·메일 발송·수동
// 발송 기록·취소를 이 자리에서 처리한다. 발주서 1장 = 주문 1건 × 매입처 1곳.

interface GroupItem {
  id: string; line_no: number; item_code: string | null; item_name: string | null
  order_kind: string | null; quantity: number | null
  purchase_price: number | null; purchase_total: number | null
  sale_price: number | null; line_total: number | null
  memo: string | null
  po_id: string | null; po_no: string | null
}
interface Group {
  key: string; alias_id: string | null; vendor_name: string
  vendor_id: string | null; email: string | null; payment_term: string | null
  uses_custom_po: boolean; po_use_sale_price: boolean; items: GroupItem[]
}
interface Po {
  id: string; po_no: string; vendor_name: string; total_amount: number
  send_method: string | null; sent_at: string | null; send_error: string | null
  email_to: string | null; status: string; created_at: string
  sender_name: string | null; item_count: number; broken_count: number
  uses_custom_po?: boolean; po_use_sale_price?: boolean
}

const won = (n: number | null) => (n ?? 0).toLocaleString('ko-KR')

export default function PurchaseSection({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [groups, setGroups] = useState<Group[]>([])
  const [pos, setPos] = useState<Po[]>([])
  const [smtpReady, setSmtpReady] = useState(false)
  const [deliveryNote, setDeliveryNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 그룹별 선택 품목·이메일 입력
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [emails, setEmails] = useState<Record<string, string>>({})   // group.key → email
  const [openPo, setOpenPo] = useState<string | null>(null)   // 내용 펼친 발주서

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const res = await fetch(`/api/orders-portal/orders/${orderId}/purchase`)
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? '조회 실패'); setLoading(false); return }
    setGroups(json.groups ?? [])
    setPos(json.pos ?? [])
    setSmtpReady(!!json.smtp_ready)
    setDeliveryNote(prev => prev || (json.delivery_note ?? ''))
    // 미발주 품목은 기본 전체 선택, 이메일은 매입처 마스터 값 프리필
    const ck: Record<string, boolean> = {}
    const em: Record<string, string> = {}
    for (const g of (json.groups ?? []) as Group[]) {
      for (const it of g.items) if (!it.po_id) ck[it.id] = true
      em[g.key] = g.email ?? ''
    }
    setChecked(prev => ({ ...ck, ...prev }))
    setEmails(prev => ({ ...em, ...prev }))
    setLoading(false)
  }, [orderId])
  useEffect(() => { load() }, [load])

  const createPo = async (g: Group) => {
    const itemIds = g.items.filter(it => !it.po_id && checked[it.id]).map(it => it.id)
    if (!itemIds.length) { setError('발주할 품목을 선택해주세요.'); return }
    setBusy(true); setError(null); setNotice(null)
    const res = await fetch(`/api/orders-portal/orders/${orderId}/purchase`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_ids: itemIds,
        email_to: emails[g.key] || null,
        delivery_note: deliveryNote || null,
      }),
    })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) { setError(json.error ?? '발주서 생성 실패'); return }
    // 생성 즉시 발송 페이지로 — 다운로드 확인 → 첨부 → 메일 작성 → 발송 (시안 v3)
    router.push(`/orders/purchase/${json.po_id}`)
  }

  const downloadExcel = (po: Po) => {
    const a = document.createElement('a')
    a.href = `/api/orders-portal/purchase-orders/${po.id}?excel=1`
    a.click()
  }

  const sendBadge = (p: Po) => {
    if (p.status === 'canceled')
      return <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-400">취소됨</span>
    if (p.sent_at && p.send_method === 'email')
      return <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-700">메일 발송됨</span>
    if (p.sent_at)
      return <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-700">수동 발송됨</span>
    return <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800">미발송</span>
  }

  const pendingGroups = groups
    .map(g => ({ ...g, pending: g.items.filter(it => !it.po_id) }))
    .filter(g => g.pending.length > 0)

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3">
        <div className="text-sm font-bold text-gray-900">발주</div>
        <div className="text-sm text-gray-400 mt-2">불러오는 중...</div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3">
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="text-sm font-bold text-gray-900">발주</div>
        <span className="text-[11px] text-gray-400">발주서 1장 = 이 주문 × 매입처 1곳 · 발송 후 대금결제는 매입처 정산에서</span>
        {!smtpReady && (
          <span className="ml-auto text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
            메일 발송 미설정 — 엑셀 다운로드 후 수동 발송 기록으로 처리
          </span>
        )}
      </div>

      {error && <div className="mt-3 px-3.5 py-2 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}
      {notice && <div className="mt-3 px-3.5 py-2 bg-emerald-50 text-emerald-700 text-sm rounded-lg">{notice}</div>}

      {/* 작성된 발주서 */}
      {pos.length > 0 && (
        <div className="mt-3 space-y-2">
          {pos.map(p => (
            <div key={p.id}
              className={`border rounded-lg px-3.5 py-2.5 ${p.status === 'canceled' ? 'border-gray-100 bg-gray-50/60' : 'border-gray-200'}`}>
              <div className="flex items-center gap-2.5 flex-wrap text-sm">
                <button type="button" onClick={() => setOpenPo(v => v === p.id ? null : p.id)}
                  title="발주서 내용 펼치기/접기"
                  className="flex items-center gap-1.5 hover:opacity-70">
                  <span className="text-gray-400 text-xs">{openPo === p.id ? '▾' : '▸'}</span>
                  <span className="font-semibold tabular-nums">{p.po_no}</span>
                  <span className={p.status === 'canceled' ? 'text-gray-400' : 'text-gray-700'}>{p.vendor_name}</span>
                </button>
                <span className="text-xs text-gray-400">품목 {p.item_count}건 · {won(p.total_amount)}원</span>
                {p.uses_custom_po && (
                  <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium bg-violet-50 text-violet-600"
                    title="자체 발주서 양식을 쓰는 매입처 — 자사 양식은 참고용, 수동 발송 기록 권장">자체 양식</span>
                )}
                {p.po_use_sale_price && (
                  <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-600"
                    title="발주서 금액이 매입가 대신 판매가로 기재되는 매입처 (요아럽)">판매가 발주</span>
                )}
                {sendBadge(p)}
                {p.sent_at && (
                  <span className="text-[11px] text-gray-400 tabular-nums">
                    {p.sent_at.slice(0, 16).replace('T', ' ')}{p.sender_name ? ` · ${p.sender_name}` : ''}
                  </span>
                )}
                {p.status === 'active' && p.broken_count > 0 && (
                  <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-50 text-red-600">
                    주문 수정됨 — 품목 {p.broken_count}건 연결 끊김, 재발주 검토
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1.5">
                  <button onClick={() => setOpenPo(v => v === p.id ? null : p.id)}
                    className="px-2.5 py-1 border border-gray-300 rounded text-xs text-gray-600 hover:border-gray-400">
                    {openPo === p.id ? '내용 접기' : '내용 보기'}
                  </button>
                  <button onClick={() => downloadExcel(p)} disabled={busy}
                    className="px-2.5 py-1 border border-gray-300 rounded text-xs text-gray-600 hover:border-gray-400">엑셀</button>
                  {/* 발송·첨부·수동 기록은 발송 페이지에서 (시안 v3 — 화면 분리) */}
                  <Link href={`/orders/purchase/${p.id}`}
                    className="px-2.5 py-1 bg-slate-900 text-white rounded text-xs">
                    {p.status === 'active' && !p.sent_at ? '발송 페이지' : '발송 상세'}
                  </Link>
                </span>
              </div>
              {p.send_error && p.status === 'active' && (
                <div className="mt-1.5 text-[11px] text-red-600">최근 발송 실패: {p.send_error} — 발송 페이지에서 재시도하세요</div>
              )}
              {openPo === p.id && <div className="mt-2.5"><PoDetail poId={p.id} /></div>}
            </div>
          ))}
        </div>
      )}

      {/* 미발주 품목 — 매입처별 */}
      {pendingGroups.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs text-gray-500 mb-1.5">미발주 품목 — 매입처별로 선택해 발주서를 만드세요</div>
          <div className="mb-2">
            <label className="block text-[11px] text-gray-400 mb-1">배송 참고 (발주서에 함께 인쇄 — 주문 메모·상담일지에서 자동 취합, 수정 가능)</label>
            <textarea value={deliveryNote} onChange={e => setDeliveryNote(e.target.value)} rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div className="space-y-2.5">
            {pendingGroups.map(g => {
              const selected = g.pending.filter(it => checked[it.id])
              // 판매가 발주 매입처(요아럽)는 발주서에 기재될 판매 금액으로 집계
              const amountOf = (it: GroupItem) =>
                (g.po_use_sale_price ? it.line_total : it.purchase_total) ?? 0
              const sum = selected.reduce((s, it) => s + amountOf(it), 0)
              return (
                <div key={g.key} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3.5 py-2 bg-gray-50 border-b border-gray-100 flex-wrap">
                    <span className="text-sm font-semibold">{g.vendor_name}</span>
                    {g.payment_term && <span className="text-[11px] text-gray-400">{g.payment_term}</span>}
                    {g.uses_custom_po && (
                      <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium bg-violet-50 text-violet-600"
                        title="자체 발주서 양식을 쓰는 매입처 — 자사 양식은 참고용, 발송 후 수동 발송 기록 권장">자체 양식</span>
                    )}
                    {g.po_use_sale_price && (
                      <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-600"
                        title="발주서 금액이 매입가 대신 판매가로 기재됩니다 (요아럽 — 사용자 확정)">판매가 발주</span>
                    )}
                    {!g.alias_id && (
                      <span className="text-[11px] text-red-500">매입처 미연결 — 발주서에 매입처 정보가 비어 나갑니다</span>
                    )}
                    <input value={emails[g.key] ?? ''} onChange={e => setEmails(prev => ({ ...prev, [g.key]: e.target.value }))}
                      placeholder="발주 이메일 (매입처 마스터에서 프리필)" type="email"
                      className="ml-auto w-64 border border-gray-300 rounded px-2.5 py-1 text-xs bg-white" />
                  </div>
                  <div className="px-3.5 py-1.5">
                    {g.pending.map(it => (
                      <label key={it.id} className="flex items-center gap-2.5 py-1 text-xs cursor-pointer">
                        <input type="checkbox" checked={!!checked[it.id]}
                          onChange={e => setChecked(prev => ({ ...prev, [it.id]: e.target.checked }))} />
                        <span className="text-gray-400 tabular-nums w-8">{it.item_code ?? '-'}</span>
                        <span className="font-medium">{it.item_name}</span>
                        {it.order_kind && <span className="text-gray-400">{it.order_kind}</span>}
                        <span className="ml-auto tabular-nums">× {it.quantity ?? 0}</span>
                        <span className="tabular-nums w-24 text-right">{won(amountOf(it))}원</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 px-3.5 py-2 border-t border-gray-100 text-xs">
                    <span className="text-gray-500">
                      선택 {selected.length}건 · {g.po_use_sale_price ? '판매가 합계(발주서 기재액)' : '매입 합계'}{' '}
                      <b className="tabular-nums">{won(sum)}원</b>
                    </span>
                    <button onClick={() => createPo(g)} disabled={busy || !selected.length}
                      className="ml-auto px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium disabled:opacity-40">
                      발주서 생성
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        !error && (
          <div className="mt-3 text-sm text-gray-400">
            {pos.some(p => p.status === 'active')
              ? '모든 품목이 발주서에 담겼습니다.'
              : '발주할 품목이 없습니다.'}
          </div>
        )
      )}
    </div>
  )
}
