'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PAY_STAGE_CLS, PAY_STAGE_LABEL, type PayState } from '@/lib/pay-state'

// 주문 미리보기 (2026-11-18 실무자 요청) — 결제 확인 화면에서 주문번호를 누르면 화면을 벗어나지 않고 주문 내역을 보여 준다.
// 보기 전용. 매입가 · 마진은 나오지 않는다(판매 금액만). 쓰는 법: <OrderNoLink id={주문 id} no={주문번호} />
interface Preview {
  order_id: string; order_no: string | null; order_date: string; canceled: boolean
  customer_name: string; manager: string; counselor: string | null; staff_names: string[]
  items: { item_name: string | null; quantity: number; sale_price: number; line_total: number; flag: string | null }[]
  net: number; prepay?: number; outstanding: number; pay: PayState | null   // net = 청구 금액(선결제 포함)
  records: { id: string; cancel: boolean; method: string; kind: string | null; pay_date: string; amount: number; clue: string; created_by_name: string | null; confirmed_at: string | null }[]
  match_count: number; contact_count: number; memo: string | null
}
const won = (n: number) => n.toLocaleString('ko-KR')
const METHOD: Record<string, string> = { card: '카드', transfer: '계좌이체', invoice: '계산서 발행' }

export function OrderNoLink({ id, no, className = '' }: { id: string; no: string | null; className?: string }) {
  const [open, setOpen] = useState(false)
  return (<>
    <button type="button" onClick={e => { e.stopPropagation(); setOpen(true) }} title="주문 내역 보기"
      className={`tabular-nums text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900 ${className}`}>{no ?? '-'}</button>
    {open && <OrderPreviewModal id={id} onClose={() => setOpen(false)} />}
  </>)
}

function OrderPreviewModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<Preview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`/api/payment-records/order-preview?id=${id}`, { cache: 'no-store' })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (!alive) return; if (ok) setData(j as Preview); else setErr(j.error ?? '조회 실패') })
      .catch(() => { if (alive) setErr('네트워크 오류') })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { alive = false; document.removeEventListener('keydown', onKey) }
  }, [id, onClose])
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 text-left font-normal" onClick={e => { e.stopPropagation(); onClose() }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[88vh] overflow-y-auto p-5 text-sm text-gray-800 whitespace-normal" onClick={e => e.stopPropagation()}>
        {err ? <p className="text-red-600">{err}</p> : !data ? <p className="text-gray-400 py-8 text-center">불러오는 중...</p> : (<>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-gray-900">주문 {data.order_no ?? ''}</h3>
            {data.canceled ? <span className="px-1.5 py-0.5 rounded text-[0.6875rem] font-semibold bg-gray-200 text-gray-600">취소</span>
              : data.pay && <span className={`px-1.5 py-0.5 rounded text-[0.6875rem] font-semibold ${PAY_STAGE_CLS[data.pay.stage]}`}>{PAY_STAGE_LABEL[data.pay.stage]}</span>}
            <span className="ml-auto text-[0.6875rem] text-gray-400">보기 전용</span>
          </div>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 mt-3 text-sm">
            <dt className="text-gray-500">주문일</dt><dd>{data.order_date}</dd>
            <dt className="text-gray-500">은행 · 지점</dt><dd>{data.customer_name || '-'}</dd>
            <dt className="text-gray-500">고객</dt><dd>{data.manager || '-'}</dd>
            <dt className="text-gray-500">상담자</dt><dd>{data.counselor ?? '-'}</dd>
            <dt className="text-gray-500">지점 담당</dt><dd>{data.staff_names.length ? data.staff_names.join(', ') : <span className="text-gray-400">담당 미지정</span>}</dd>
            {data.memo && (<><dt className="text-gray-500">주문 메모</dt><dd className="whitespace-pre-line">{data.memo}</dd></>)}
          </dl>
          <div className="mt-3 border border-gray-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-200 bg-gray-50">
                <th className="py-1.5 px-2.5 font-medium">품명</th><th className="py-1.5 px-2.5 font-medium text-right">수량</th>
                <th className="py-1.5 px-2.5 font-medium text-right">판매가</th><th className="py-1.5 px-2.5 font-medium text-right">합계</th>
              </tr></thead>
              <tbody>
                {data.items.map((it, i) => (
                  <tr key={i} className={`border-b border-gray-100 ${it.flag ? 'text-gray-400' : ''}`}>
                    <td className="py-1.5 px-2.5">{it.item_name ?? '-'}{it.flag && <span className="ml-1 px-1 rounded bg-gray-100 text-[0.625rem]">{it.flag}</span>}</td>
                    <td className="py-1.5 px-2.5 text-right tabular-nums">{won(it.quantity)}</td>
                    <td className="py-1.5 px-2.5 text-right tabular-nums">{won(it.sale_price)}</td>
                    <td className="py-1.5 px-2.5 text-right tabular-nums">{won(it.line_total)}</td>
                  </tr>
                ))}
                {data.items.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-gray-400">품목이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-4 mt-2 text-sm">
            <span>청구 금액 <b className="tabular-nums">{won(data.net)}원</b>{(data.prepay ?? 0) > 0 && <span className="text-[0.6875rem] text-violet-700"> (선결제 {won(data.prepay ?? 0)} 포함)</span>}</span>
            <span>미수 <b className={`tabular-nums ${data.outstanding > 0 ? 'text-red-700' : ''}`}>{won(data.outstanding)}원</b></span>
          </div>
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 space-y-0.5">
            {data.records.length === 0 ? <p className="text-gray-400">결제 기록 없음</p> : data.records.map(r => (
              <p key={r.id} className={r.cancel ? 'text-orange-700' : ''}>
                {r.pay_date} · {r.cancel ? '취소' : METHOD[r.method] ?? r.method}{r.kind ? `(${r.kind})` : ''} · {r.cancel ? '−' : ''}{won(r.amount)}원 · {r.clue}
                <span className="text-gray-400"> · {r.created_by_name ?? ''} · {r.confirmed_at ? '매칭 완료' : r.cancel ? '취소 대기' : '매칭 대기'}</span>
              </p>
            ))}
            <p className="text-gray-400">수금 매칭 {data.match_count}건 · 연락 기록 {data.contact_count}건 · 매입가와 마진은 이 창에 나오지 않습니다</p>
          </div>
        </>)}
        <div className="flex justify-end gap-2 mt-4">
          <Link href={`/orders/${id}`} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">주문 상세 열기</Link>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm bg-slate-900 text-white font-semibold">닫기</button>
        </div>
      </div>
    </div>
  )
}
