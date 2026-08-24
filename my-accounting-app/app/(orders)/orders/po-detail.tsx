'use client'

import { Fragment, useEffect, useState } from 'react'
import {
  COMPANY_NAME, PO_COLORS, PO_HEADERS, PO_NUM_COLS, ROSTER_HEADERS,
  poFormInfo, poFormItemRows, poRosterRows, type PoExcelData,
} from '@/lib/po-form'

// 발주서 미리보기 — 엑셀에 찍히는 실제 양식(2026-08-24 개정: 발주서+배송명단
// 2시트)을 그대로 재현. 값·순서·색은 lib/po-form.ts 공용 정의를 써서 엑셀
// 출력과 항상 동일하다. 주문 상세 발주 섹션·발송 페이지·발주서 이력 공용.

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
  const roster = poRosterRows(form)
  const broken = (data.items ?? []).filter(it => !it.order_item_id).length
  const cellBorder = { border: '1px solid #cbd5e1' }
  const infoRows = [info.slice(0, 3), info.slice(3, 6), info.slice(6, 9)]

  return (
    <div>
      {/* 시트1: 발주서 (명세) */}
      <div className="overflow-x-auto">
        <div className="min-w-[640px] max-w-3xl bg-white border border-gray-300 rounded-lg p-3 shadow-sm">
          <div className="text-center text-lg font-extrabold py-1.5 tracking-tight"
            style={{ color: hex(PO_COLORS.navy) }}>
            {COMPANY_NAME} 발주서
          </div>

          {/* 헤더 정보 3행 — 발주번호 맨 위, 출고요청일 라벨 강조 */}
          <table className="w-full border-collapse text-[11px]">
            <tbody>
              {infoRows.map((cells, ri) => (
                <tr key={ri}>
                  {cells.map(c => (
                    <Fragment key={c.label}>
                      <td className="px-2 py-1.5 text-center font-semibold"
                        style={{
                          ...cellBorder,
                          background: hex(c.accent ? PO_COLORS.accentBg : PO_COLORS.labelBg),
                          color: hex(c.accent ? PO_COLORS.accentInk : PO_COLORS.label),
                          width: '13%',
                        }}>
                        {c.label}
                      </td>
                      <td className={`px-2 py-1.5 text-center ${c.bold ? 'font-semibold' : ''}`}
                        style={{ ...cellBorder, color: hex(PO_COLORS.ink), width: '20.3%' }}>
                        {c.value ?? ''}
                      </td>
                    </Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {/* 품목 표 6열 (배송구분 열 없음 — 비고 통일), 택배비는 별도 행 */}
          <table className="w-full border-collapse text-[11px] mt-1.5">
            <thead>
              <tr>
                {PO_HEADERS.map(label => (
                  <th key={label} className="px-1.5 py-1.5 font-semibold whitespace-nowrap"
                    style={{ ...cellBorder, background: hex(PO_COLORS.labelBg), color: hex(PO_COLORS.label) }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((values, ri) => (
                <tr key={ri}>
                  {values.map((v, ci) => (
                    <td key={ci}
                      className={`px-1.5 py-1.5 text-center align-middle ${PO_NUM_COLS.has(ci) ? 'tabular-nums' : ''}`}
                      style={{
                        ...cellBorder,
                        color: hex(ci === 2 ? PO_COLORS.qtyInk : PO_COLORS.ink),   // 수량 빨강
                      }}>
                      {ci === 3 || ci === 4 ? won(Number(v)) : v}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td colSpan={5} className="px-2 py-1.5 text-center font-semibold"
                  style={{ ...cellBorder, background: hex(PO_COLORS.labelBg), color: hex(PO_COLORS.label) }}>
                  합계금액(vat포함)
                </td>
                <td className="px-2 py-1.5 text-center font-bold tabular-nums"
                  style={{ ...cellBorder, color: hex(PO_COLORS.totalInk) }}>
                  {won(form.total_amount)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 시트2: 배송명단 */}
      <div className="overflow-x-auto mt-2">
        <div className="min-w-[860px] bg-white border border-gray-300 rounded-lg p-3 shadow-sm">
          <div className="text-xs font-bold text-gray-700 mb-1.5">배송명단 (시트 2)</div>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                {ROSTER_HEADERS.map(label => (
                  <th key={label} className="px-1.5 py-1.5 font-semibold whitespace-nowrap"
                    style={{ ...cellBorder, background: hex(PO_COLORS.labelBg), color: hex(PO_COLORS.label) }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roster.map((values, ri) => (
                <tr key={ri}>
                  {values.map((v, ci) => (
                    <td key={ci}
                      className={`px-1.5 py-1.5 align-middle ${ci === 4 || ci === 8 ? 'text-left' : 'text-center'}`}
                      style={{ ...cellBorder, color: hex(PO_COLORS.ink) }}>
                      {v}
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
          엑셀 다운로드·메일 첨부와 동일한 내용입니다. 배송명단의 주소 등 빈 칸은
          다운로드 후 수기로 보완합니다 (개별배송 명단 관리 기능은 4페이즈 예정).
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
