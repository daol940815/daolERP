'use client'

import { Fragment, useEffect, useState } from 'react'
import {
  COMPANY_NAME, PO_COLORS, PO_HEADERS, PO_GOLD_COLS, PO_NUM_COLS,
  poFormInfo, poFormItemRows, type PoExcelData,
} from '@/lib/po-form'

// 발주서 미리보기 — 엑셀에 찍히는 실제 양식(다올커머스 발주서)을 그대로 재현.
// 값·순서·색은 lib/po-form.ts 공용 정의를 써서 엑셀 출력과 항상 동일하다.
// 주문 상세의 발주 섹션과 발주서 이력 화면에서 공용.

interface Data {
  form: PoExcelData
  items: { order_item_id: string | null }[]
  po: { status: string; email_to: string | null }
}

const won = (n: number) => (n ?? 0).toLocaleString('ko-KR')
const hex = (c: string) => `#${c}`

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
  if (!data?.form) return <div className="px-3 py-2 text-xs text-gray-400">발주서 내용을 불러오는 중...</div>

  const form = data.form
  const info = poFormInfo(form)
  const rows = poFormItemRows(form)
  const broken = (data.items ?? []).filter(it => !it.order_item_id).length
  const cellBorder = { border: '1px solid #cbd5e1' }

  // 정보 그리드: 12칸을 3칸 × 4행으로 배치 (엑셀 병합 배치와 동일)
  const infoRows = [info.slice(0, 3), info.slice(3, 6), info.slice(6, 9), info.slice(9, 12)]

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[900px] bg-white border border-gray-300 rounded-lg p-3 shadow-sm">
          {/* 제목 */}
          <div className="text-center text-lg font-extrabold py-1.5 tracking-tight"
            style={{ color: hex(PO_COLORS.navy) }}>
            {COMPANY_NAME} 발주서
          </div>

          {/* 정보 그리드 */}
          <table className="w-full border-collapse text-[11px]">
            <colgroup>
              {[0, 1, 2].map(i => (
                <Fragment key={i}>
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '22.3%' }} />
                </Fragment>
              ))}
            </colgroup>
            <tbody>
              {infoRows.map((cells, ri) => (
                <tr key={ri}>
                  {cells.map(c => {
                    const isTotal = c.label.startsWith('총 합계금액')
                    return (
                      <Fragment key={c.label}>
                        <td className="px-2 py-1.5 text-center font-semibold"
                          style={{ ...cellBorder, background: hex(PO_COLORS.labelBg), color: hex(PO_COLORS.label) }}>
                          {c.label}
                        </td>
                        <td className={`px-2 py-1.5 ${isTotal ? 'text-right font-bold' : c.bold ? 'font-semibold' : ''}`}
                          style={{
                            ...cellBorder,
                            ...(isTotal
                              ? { background: hex(PO_COLORS.totalBg), color: hex(PO_COLORS.totalInk), fontSize: '12px' }
                              : { color: hex(PO_COLORS.ink) }),
                          }}>
                          {isTotal ? `${won(Number(c.value ?? 0))} 원` : (c.value ?? '')}
                        </td>
                      </Fragment>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* 품목 표 (엑셀과 동일한 15열) */}
          <table className="w-full border-collapse text-[11px] mt-1.5">
            <thead>
              <tr>
                {PO_HEADERS.map(h => (
                  <th key={h.label} className="px-1.5 py-1.5 font-semibold text-white whitespace-nowrap"
                    style={{ ...cellBorder, background: hex(h.tone === 'navy' ? PO_COLORS.navy : PO_COLORS.gold) }}>
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((values, ri) => (
                <tr key={ri}>
                  {values.map((v, ci) => (
                    <td key={ci}
                      className={`px-1.5 py-1.5 align-middle ${
                        ci === 0 || ci === 5 ? 'text-center' : PO_NUM_COLS.has(ci) ? 'text-right tabular-nums' : 'text-left'
                      } ${ci === 11 ? 'font-semibold' : ''}`}
                      style={{
                        ...cellBorder,
                        color: hex(PO_COLORS.ink),
                        ...(PO_GOLD_COLS.has(ci + 1) ? { background: hex(PO_COLORS.goldRowBg) } : {}),
                      }}>
                      {PO_NUM_COLS.has(ci) ? won(Number(v)) : v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-1.5 space-y-0.5 text-[11px] text-gray-400">
        <div>
          엑셀 다운로드·메일 첨부와 동일한 내용입니다. 골드색 칸(발송인·수령인·주소·배송메모·송장번호)은
          배송 관련 수기 보완란 — 아는 값은 미리 채워져 있고 나머지는 다운로드 후 기입합니다.
        </div>
        {data.po?.email_to && <div>받는 이메일: <span className="text-gray-600">{data.po.email_to}</span></div>}
        {broken > 0 && (
          <div className="text-red-500">
            주문 수정으로 연결이 끊긴 품목 {broken}건 — 발주서는 발주 시점 내용으로 보존되며, 해당 품목은 주문에서 미발주로 표시됩니다.
          </div>
        )}
      </div>
    </div>
  )
}
