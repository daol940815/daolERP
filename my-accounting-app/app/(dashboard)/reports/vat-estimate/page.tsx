'use client'

// 예상 부가세 — 신고서 서식 행 x (월별 열 + 신고기간 계)
// 자동 집계: 세금계산서·신용카드/현금영수증 (월별로 의미 있는 발생 항목)
// 수동 입력: 현금매출(원천 생기면 자동 전환 예정)·영세율·대손·경감공제·예정고지 등
//            — 월로 쪼개지 않는 항목은 월 칸을 빗금 처리하고 신고기간 계에만 표시

import { useCallback, useEffect, useState } from 'react'

interface CellV { supply: number; tax: number }
interface ReturnView {
  year: number; m1: number; m2: number; months: number[]; period_key: string
  auto: {
    sales_invoice: CellV[]; sales_card_cash: CellV[]
    purchase_invoice: CellV[]; purchase_card_cash: CellV[]; purchase_nondeduct: CellV[]
  }
  manual: Record<string, CellV>
  card_missing: { count: number; amount: number }
  migration106: boolean
}

const fmt = (n: number) => n === 0 ? '' : n.toLocaleString('ko-KR')
const fmt0 = (n: number) => n.toLocaleString('ko-KR')

const PRESETS = [
  { label: '1기 예정 (1~3월)', m1: 1, m2: 3 },
  { label: '1기 확정 (4~6월)', m1: 4, m2: 6 },
  { label: '1기 전체 (1~6월)', m1: 1, m2: 6 },
  { label: '2기 예정 (7~9월)', m1: 7, m2: 9 },
  { label: '2기 확정 (10~12월)', m1: 10, m2: 12 },
  { label: '2기 전체 (7~12월)', m1: 7, m2: 12 },
]

// 수동 입력 항목 정의: 어떤 값(공급가/세액)을 받는지
const MANUAL_META: Record<string, { label: string; fields: ('supply' | 'tax')[] }> = {
  cash_sales:     { label: '현금 매출',           fields: ['supply', 'tax'] },
  zero_invoice:   { label: '영세율 세금계산서',    fields: ['supply'] },
  zero_other:     { label: '영세율 기타',          fields: ['supply'] },
  bad_debt:       { label: '대손세액 가감',        fields: ['tax'] },
  reduce_other:   { label: '그밖의 경감·공제세액', fields: ['tax'] },
  card_issue:     { label: '신용카드발행공제',     fields: ['tax'] },
  prepaid_refund: { label: '예정신고미환급세액',   fields: ['tax'] },
  prepaid_notice: { label: '예정고지세액',         fields: ['tax'] },
  penalty:        { label: '가산세액계',           fields: ['tax'] },
}

// 세액(위)·공급가액(아래) 2줄 셀
function Cell({ c }: { c: CellV }) {
  return (
    <td className="py-1.5 px-2 text-right whitespace-nowrap">
      <span className="block text-[12px] text-slate-900 font-medium">{fmt(c.tax)}</span>
      <span className="block text-[10px] text-slate-400">{fmt(c.supply)}</span>
    </td>
  )
}
function TotCell({ c }: { c: CellV }) {
  return (
    <td className="py-1.5 px-2 text-right whitespace-nowrap bg-blue-50/60 border-l-2 border-blue-200">
      <span className="block text-[12px] font-semibold text-slate-900">{fmt(c.tax)}</span>
      <span className="block text-[10px] text-slate-400">{fmt(c.supply)}</span>
    </td>
  )
}

export default function VatEstimatePage() {
  const now = new Date()
  const defaultPreset = now.getMonth() + 1 <= 6 ? 2 : 5
  const [year, setYear] = useState(now.getFullYear())
  const [preset, setPreset] = useState(defaultPreset)
  const [v, setV] = useState<ReturnView | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)

  const { m1, m2 } = PRESETS[preset]
  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000) }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/reports/vat-estimate?view=return&year=${year}&m1=${m1}&m2=${m2}`)
    const json = await res.json()
    if (res.ok) setV(json)
    else showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`)
    setLoading(false)
  }, [year, m1, m2])
  useEffect(() => { load() }, [load])

  const manual = (k: string): CellV => v?.manual[k] ?? { supply: 0, tax: 0 }

  const editManual = async (k: string) => {
    if (!v) return
    if (!v.migration106) { showMsg('마이그레이션 106 실행 후 입력할 수 있습니다.'); return }
    const meta = MANUAL_META[k]
    const cur = manual(k)
    const values: { supply: number; tax: number } = { ...cur }
    for (const f of meta.fields) {
      const label = f === 'supply' ? '공급가액' : '세액'
      const raw = window.prompt(`[${meta.label}] ${label}을 입력하세요 (음수 가능):`, String(values[f] || 0))
      if (raw === null) return
      const n = Math.round(Number(raw.replace(/,/g, '')))
      if (!Number.isFinite(n)) { showMsg('숫자가 올바르지 않습니다.'); return }
      values[f] = n
    }
    const res = await fetch('/api/reports/vat-estimate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_manual', period_key: v.period_key, item_key: k,
        supply_amount: values.supply, tax_amount: values.tax }),
    })
    const json = await res.json()
    if (!res.ok) { showMsg(json.error ?? '저장 실패'); return }
    showMsg(`${meta.label} 저장됨`)
    load()
  }

  // ── 파생 합계 ──
  const n = v?.months.length ?? 0
  const at = (cells: CellV[] | undefined, i: number): CellV => cells?.[i] ?? { supply: 0, tax: 0 }
  const salesCell = (i: number): CellV => ({
    supply: at(v?.auto.sales_invoice, i).supply + at(v?.auto.sales_card_cash, i).supply,
    tax: at(v?.auto.sales_invoice, i).tax + at(v?.auto.sales_card_cash, i).tax,
  })
  const salesTotal: CellV = v ? {
    supply: salesCell(n).supply + manual('cash_sales').supply + manual('zero_invoice').supply + manual('zero_other').supply,
    tax: salesCell(n).tax + manual('cash_sales').tax + manual('bad_debt').tax,
  } : { supply: 0, tax: 0 }
  const buyCell = (i: number): CellV => ({
    supply: at(v?.auto.purchase_invoice, i).supply + at(v?.auto.purchase_card_cash, i).supply - at(v?.auto.purchase_nondeduct, i).supply,
    tax: at(v?.auto.purchase_invoice, i).tax + at(v?.auto.purchase_card_cash, i).tax - at(v?.auto.purchase_nondeduct, i).tax,
  })
  const payMonthly = (i: number) => salesCell(i).tax - buyCell(i).tax
  const payTotal = salesTotal.tax - buyCell(n).tax
  const reduceTotal = manual('reduce_other').tax + manual('card_issue').tax
  const finalTax = payTotal - reduceTotal - manual('prepaid_refund').tax - manual('prepaid_notice').tax + manual('penalty').tax

  const naCells = () => v?.months.map(m => (
    <td key={m} className="py-1.5 px-2 text-center text-slate-300 bg-[repeating-linear-gradient(45deg,#fafbfc,#fafbfc_6px,#f1f5f9_6px,#f1f5f9_7px)]">—</td>
  ))
  const manualTot = (k: string, opt?: { taxOnly?: boolean }) => {
    const c = manual(k)
    const has = c.supply !== 0 || c.tax !== 0
    return (
      <td className="py-1.5 px-2 text-right whitespace-nowrap bg-blue-50/60 border-l-2 border-blue-200 cursor-pointer hover:bg-blue-100/60"
        onClick={() => editManual(k)} title="클릭하여 입력">
        <span className="block text-[12px] font-semibold text-slate-900">
          {has
            ? fmt0(c.tax)
            : <span className="text-[10px] font-normal text-blue-500 border border-blue-300 rounded px-1">입력</span>}
        </span>
        {!opt?.taxOnly && has && <span className="block text-[10px] text-slate-400">{fmt(c.supply)}</span>}
      </td>
    )
  }
  const th = 'py-2 px-2 text-[11.5px] font-medium whitespace-nowrap'

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">예상 부가세</h1>
          <p className="text-sm mt-1 text-gray-500">
            신고서 서식 그대로, 월별 발생 흐름과 신고기간 합계를 함께 봅니다. 월로 쪼갤 수 없는 정산 항목은 신고기간 계에만 표시됩니다.
          </p>
        </div>
        <a href={v ? `/api/reports/vat-estimate/export?from=${v.year}-${String(v.m1).padStart(2, '0')}-01&to=${v.year}-${String(v.m2).padStart(2, '0')}-${new Date(v.year, v.m2, 0).getDate()}` : '#'}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          ↓ 엑셀 다운로드
        </a>
      </div>

      {msg && <div className="my-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {v && !v.migration106 && (
        <div className="my-3 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
          마이그레이션 106(vat_manual_entries)이 아직 실행되지 않았습니다 — 현금매출·영세율·대손·경감공제 등 수동 입력이 비활성입니다.
        </div>
      )}

      {/* 연도 + 신고기간 칩 */}
      <div className="flex items-center gap-2 my-4 flex-wrap">
        <div className="flex items-center gap-1 mr-2">
          <button onClick={() => setYear(y => y - 1)} className="px-2 py-1 border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50">←</button>
          <span className="text-sm font-semibold text-gray-900 w-14 text-center">{year}년</span>
          <button onClick={() => setYear(y => y + 1)} className="px-2 py-1 border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50">→</button>
        </div>
        {PRESETS.map((p, i) => (
          <button key={p.label} onClick={() => setPreset(i)}
            className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
              preset === i ? 'bg-slate-900 text-white border-slate-900 font-semibold' : 'bg-white text-gray-600 border-gray-300 hover:border-slate-500'}`}>
            {p.label}
          </button>
        ))}
      </div>

      {loading || !v ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="border border-gray-200 rounded-lg px-4 py-3 bg-white">
              <p className="text-xs text-gray-400 mb-1">차가감 납부할 세액</p>
              <p className={`text-lg font-bold ${finalTax >= 0 ? 'text-red-600' : 'text-blue-600'}`}>{fmt0(finalTax)}원</p>
              <p className="text-[11px] text-gray-400">{finalTax >= 0 ? '납부 예상' : '환급 예상'} · 정산 항목 반영</p>
            </div>
            <div className="border border-gray-200 rounded-lg px-4 py-3 bg-white">
              <p className="text-xs text-gray-400 mb-1">{v.months[n - 1]}월 발생 부가세</p>
              <p className="text-lg font-bold text-gray-900">{fmt0(payMonthly(n - 1))}원</p>
              <p className="text-[11px] text-gray-400">해당 월 매출세액 - 매입세액</p>
            </div>
            <div className="border border-gray-200 rounded-lg px-4 py-3 bg-white">
              <p className="text-xs text-gray-400 mb-1">매출세액 계</p>
              <p className="text-lg font-bold text-gray-900">{fmt0(salesTotal.tax)}원</p>
              <p className="text-[11px] text-gray-400">공급가액 {fmt0(salesTotal.supply)}원</p>
            </div>
            <div className="border border-gray-200 rounded-lg px-4 py-3 bg-white">
              <p className="text-xs text-gray-400 mb-1">매입세액 차감계</p>
              <p className="text-lg font-bold text-gray-900">{fmt0(buyCell(n).tax)}원</p>
              <p className="text-[11px] text-gray-400">공급가액 {fmt0(buyCell(n).supply)}원</p>
            </div>
          </div>

          {v.card_missing.count > 0 && (
            <div className="mb-3 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg">
              카드매출 중 공급가·세액 구분 미기재 {v.card_missing.count}건 ({fmt0(v.card_missing.amount)}원)이 있습니다 — 현재 세액 0으로 집계되므로 원자료 확인이 필요합니다.
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead>
                <tr className="bg-slate-900 text-slate-200">
                  <th className={`${th} text-left`} colSpan={3}>구분</th>
                  {v.months.map(m => <th key={m} className={`${th} text-right w-[110px]`}>{m}월</th>)}
                  <th className={`${th} text-right w-[130px] bg-blue-800`}>신고기간 계</th>
                </tr>
              </thead>
              <tbody className="[&_td]:border-b [&_td]:border-gray-100">
                <tr>
                  <td rowSpan={6} className="py-1.5 px-2 font-bold text-slate-900 bg-slate-50 whitespace-nowrap">과세표준<br />및<br />매출세액</td>
                  <td rowSpan={3} className="py-1.5 px-2 text-center text-xs text-slate-500 bg-slate-50">과세</td>
                  <td className="py-1.5 px-2 text-slate-600">세금계산서</td>
                  {v.months.map((m, i) => <Cell key={m} c={at(v.auto.sales_invoice, i)} />)}
                  <TotCell c={at(v.auto.sales_invoice, n)} />
                </tr>
                <tr>
                  <td className="py-1.5 px-2 text-slate-600">신용카드/현금영수증</td>
                  {v.months.map((m, i) => <Cell key={m} c={at(v.auto.sales_card_cash, i)} />)}
                  <TotCell c={at(v.auto.sales_card_cash, n)} />
                </tr>
                <tr>
                  <td className="py-1.5 px-2 text-slate-600">현금 <span className="text-[10px] text-blue-500">수동</span></td>
                  {naCells()}
                  {manualTot('cash_sales')}
                </tr>
                <tr>
                  <td rowSpan={2} className="py-1.5 px-2 text-center text-xs text-slate-500 bg-slate-50">영세</td>
                  <td className="py-1.5 px-2 text-slate-600">세금계산서 <span className="text-[10px] text-blue-500">수동</span></td>
                  {naCells()}
                  {manualTot('zero_invoice')}
                </tr>
                <tr>
                  <td className="py-1.5 px-2 text-slate-600">기타 <span className="text-[10px] text-blue-500">수동</span></td>
                  {naCells()}
                  {manualTot('zero_other')}
                </tr>
                <tr className="text-slate-500">
                  <td colSpan={2} className="py-1.5 px-2">대손세액 가감 <span className="text-[10px] text-blue-500">수동</span></td>
                  {naCells()}
                  {manualTot('bad_debt', { taxOnly: true })}
                </tr>
                <tr className="bg-slate-100 font-semibold">
                  <td colSpan={3} className="py-1.5 px-2 text-slate-900">계</td>
                  {v.months.map((m, i) => <Cell key={m} c={salesCell(i)} />)}
                  <TotCell c={salesTotal} />
                </tr>

                <tr>
                  <td rowSpan={3} className="py-1.5 px-2 font-bold text-slate-900 bg-slate-50">매입세액</td>
                  <td colSpan={2} className="py-1.5 px-2 text-slate-600">세금계산서</td>
                  {v.months.map((m, i) => <Cell key={m} c={at(v.auto.purchase_invoice, i)} />)}
                  <TotCell c={at(v.auto.purchase_invoice, n)} />
                </tr>
                <tr>
                  <td colSpan={2} className="py-1.5 px-2 text-slate-600">신용카드/현금영수증</td>
                  {v.months.map((m, i) => <Cell key={m} c={at(v.auto.purchase_card_cash, i)} />)}
                  <TotCell c={at(v.auto.purchase_card_cash, n)} />
                </tr>
                <tr>
                  <td colSpan={2} className="py-1.5 px-2 text-slate-600">공제받지못할매입세액 (차감)</td>
                  {v.months.map((m, i) => <Cell key={m} c={at(v.auto.purchase_nondeduct, i)} />)}
                  <TotCell c={at(v.auto.purchase_nondeduct, n)} />
                </tr>
                <tr className="bg-slate-100 font-semibold">
                  <td colSpan={3} className="py-1.5 px-2 text-slate-900">차감계</td>
                  {v.months.map((m, i) => <Cell key={m} c={buyCell(i)} />)}
                  <TotCell c={buyCell(n)} />
                </tr>

                <tr className="bg-amber-50 border-y-2 border-amber-200 font-semibold">
                  <td colSpan={3} className="py-1.5 px-2 text-amber-900">납부세액 <span className="text-[10px] font-normal text-amber-700">월별 = 발생분 · 계 = 수동 항목 반영</span></td>
                  {v.months.map((m, i) => (
                    <td key={m} className="py-1.5 px-2 text-right text-amber-800 font-semibold whitespace-nowrap">{fmt0(payMonthly(i))}</td>
                  ))}
                  <td className="py-1.5 px-2 text-right bg-amber-100 border-l-2 border-amber-300 font-bold text-amber-900 whitespace-nowrap">{fmt0(payTotal)}</td>
                </tr>

                <tr className="text-slate-500">
                  <td rowSpan={3} className="py-1.5 px-2 font-bold text-slate-700 bg-slate-50">경감<br />공제<br />세액</td>
                  <td colSpan={2} className="py-1.5 px-2">그밖의 경감·공제세액 <span className="text-[10px] text-blue-500">수동</span></td>
                  {naCells()}
                  {manualTot('reduce_other', { taxOnly: true })}
                </tr>
                <tr className="text-slate-500">
                  <td colSpan={2} className="py-1.5 px-2">신용카드발행공제 <span className="text-[10px] text-blue-500">수동</span></td>
                  {naCells()}
                  {manualTot('card_issue', { taxOnly: true })}
                </tr>
                <tr className="text-slate-500">
                  <td colSpan={2} className="py-1.5 px-2">합계</td>
                  {naCells()}
                  <td className="py-1.5 px-2 text-right bg-blue-50/60 border-l-2 border-blue-200 font-semibold whitespace-nowrap">{fmt(reduceTotal)}</td>
                </tr>
                <tr className="text-slate-500">
                  <td colSpan={3} className="py-1.5 px-2">예정신고미환급세액 <span className="text-[10px] text-blue-500">수동</span></td>
                  {naCells()}
                  {manualTot('prepaid_refund', { taxOnly: true })}
                </tr>
                <tr className="text-slate-500">
                  <td colSpan={3} className="py-1.5 px-2">예정고지세액 <span className="text-[10px] text-blue-500">수동</span></td>
                  {naCells()}
                  {manualTot('prepaid_notice', { taxOnly: true })}
                </tr>
                <tr className="text-slate-500">
                  <td colSpan={3} className="py-1.5 px-2">가산세액계 <span className="text-[10px] text-blue-500">수동</span></td>
                  {naCells()}
                  {manualTot('penalty', { taxOnly: true })}
                </tr>
                <tr className="bg-slate-900 text-white">
                  <td colSpan={3} className="py-2 px-2 font-bold">차가감 납부할 세액</td>
                  {v.months.map(m => <td key={m} className="py-2 px-2 text-center text-slate-600">—</td>)}
                  <td className="py-2 px-2 text-right bg-slate-800 border-l-2 border-slate-700 font-bold text-amber-300 text-[14px] whitespace-nowrap">{fmt0(finalTax)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
            각 칸의 윗줄은 세액, 아랫줄 회색은 공급가액입니다. 파란 배경의 수동 항목은 클릭해 입력합니다(신고기간 단위 저장).
            현금 매출은 데이터 원천이 생기면 자동 집계로 전환할 수 있습니다. 실제 신고액과는 가산·공제 세부 항목에서 차이가 있을 수 있습니다.
          </p>
        </>
      )}
    </div>
  )
}
