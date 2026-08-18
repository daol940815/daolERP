'use client'

import { useEffect, useState } from 'react'

// 발주서 내용 미리보기 — 엑셀 다운로드 없이 발송될(된) 실제 내용을 화면에서 확인.
// 데이터는 발주 시점 스냅샷이라 주문을 수정해도 이 내용은 변하지 않는다.
// 주문 상세의 발주 섹션과 발주서 이력 화면에서 공용.

interface PoItem {
  line_no: number
  order_item_id: string | null
  item_code: string | null
  item_name: string | null
  order_kind: string | null
  quantity: number
  purchase_price: number
  purchase_shipping: number
  purchase_total: number
  memo: string | null
}
interface Data {
  po: {
    po_no: string; vendor_name: string; total_amount: number
    delivery_note: string | null; email_to: string | null
    created_at: string; status: string
  }
  items: PoItem[]
  order: { order_no: string | null; order_date: string; bank_name: string | null; branch_name: string | null } | null
}

const won = (n: number) => (n ?? 0).toLocaleString('ko-KR')

export default function PoDetail({ poId }: { poId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/orders-portal/purchase-orders/${poId}`)
      .then(async res => {
        const json = await res.json()
        if (!alive) return
        if (!res.ok) setError(json.error ?? '조회 실패')
        else setData(json)
      })
      .catch(() => { if (alive) setError('조회 실패') })
    return () => { alive = false }
  }, [poId])

  if (error) return <div className="px-3 py-2 text-xs text-red-600">{error}</div>
  if (!data) return <div className="px-3 py-2 text-xs text-gray-400">발주서 내용을 불러오는 중...</div>

  const { po, items, order } = data
  const broken = items.filter(it => !it.order_item_id).length

  return (
    <div className="border border-slate-200 rounded-lg bg-slate-50/60 p-3 text-xs">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 mb-2">
        {([
          ['발주번호', po.po_no],
          ['매입처', po.vendor_name],
          ['주문번호', order?.order_no ?? '-'],
          ['주문처', [order?.bank_name, order?.branch_name].filter(Boolean).join(' ') || '-'],
        ] as const).map(([k, v]) => (
          <div key={k}>
            <span className="text-gray-400 mr-1.5">{k}</span>
            <span className="text-gray-700 font-medium">{v}</span>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <th className="py-1.5 px-2 text-left font-medium">NO</th>
              <th className="py-1.5 px-2 text-left font-medium">품번</th>
              <th className="py-1.5 px-2 text-left font-medium">품명</th>
              <th className="py-1.5 px-2 text-left font-medium">구분</th>
              <th className="py-1.5 px-2 text-right font-medium">수량</th>
              <th className="py-1.5 px-2 text-right font-medium">매입단가</th>
              <th className="py-1.5 px-2 text-right font-medium">매입배송비</th>
              <th className="py-1.5 px-2 text-right font-medium">합계</th>
              <th className="py-1.5 px-2 text-left font-medium">비고</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.line_no} className="border-b border-gray-50">
                <td className="py-1.5 px-2 tabular-nums">{it.line_no}</td>
                <td className="py-1.5 px-2 tabular-nums whitespace-nowrap">{it.item_code ?? '-'}</td>
                <td className="py-1.5 px-2 font-medium">
                  {it.item_name}
                  {!it.order_item_id && (
                    <span className="ml-1.5 inline-block whitespace-nowrap px-1 py-0.5 rounded text-[10px] bg-red-50 text-red-500"
                      title="주문 수정으로 품목 행이 교체됨 — 발주서 내용은 발주 시점 그대로 보존">
                      주문과 연결 끊김
                    </span>
                  )}
                </td>
                <td className="py-1.5 px-2">{it.order_kind ?? '-'}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{won(it.quantity)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{won(it.purchase_price)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{it.purchase_shipping ? won(it.purchase_shipping) : '-'}</td>
                <td className="py-1.5 px-2 text-right tabular-nums font-semibold">{won(it.purchase_total)}</td>
                <td className="py-1.5 px-2 text-gray-500">{it.memo ?? '-'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7} className="py-1.5 px-2 text-right text-gray-500">합계</td>
              <td className="py-1.5 px-2 text-right tabular-nums font-bold">{won(po.total_amount)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-2 space-y-0.5">
        {po.delivery_note && (
          <div><span className="text-gray-400 mr-1.5">배송 참고</span><span className="text-gray-700">{po.delivery_note}</span></div>
        )}
        {po.email_to && (
          <div><span className="text-gray-400 mr-1.5">받는 이메일</span><span className="text-gray-700">{po.email_to}</span></div>
        )}
        {broken > 0 && (
          <div className="text-red-500">주문 수정으로 연결이 끊긴 품목 {broken}건 — 발주서는 발주 시점 내용으로 보존되며, 해당 품목은 주문에서 미발주로 표시됩니다.</div>
        )}
      </div>
    </div>
  )
}
