'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import MonthPresets from '@/components/ui/MonthPresets'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`
const eok = (n: number) => {
  const abs = Math.abs(n)
  const s = abs >= 1e8 ? `${(abs / 1e8).toFixed(2)}억` : abs >= 1e4 ? `${Math.round(abs / 1e4).toLocaleString('ko-KR')}만` : `${abs.toLocaleString('ko-KR')}원`
  return n < 0 ? `-${s}` : s
}

interface PLLineItem {
  key: string
  label: string
  is_placeholder: boolean
  is_subtotal: boolean
  is_section_header: boolean
  values: number[]
  account_id?: string
  href?: string
  note?: string
}

interface ReconcileVendor { vendor_id: string | null; vendor_name: string; erp: number; evidence: number; diff: number; erp_orders: number; invoices: number }
interface Reconcile { erp: number[]; evidence: number[]; diff: number[]; vendors: ReconcileVendor[] }

interface TaxSplitRow { revenue: number[]; cogs: number[]; gross: number[] }
interface TaxSplit { taxable: TaxSplitRow; exempt: TaxSplitRow; other: TaxSplitRow }

interface MonthlyPLResult {
  months: string[]
  basis: 'evidence' | 'erp'
  items: PLLineItem[]
  reconcile?: Reconcile
  taxSplit?: TaxSplit
}

const monthStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

const formatMonth = (m: string) => {
  const [y, mm] = m.split('-')
  return `${y}.${mm}`
}

// 'YYYY-MM' → 그 달의 마지막 날짜 (원장 드릴다운 기간용)
const lastDay = (yyyyMm: string) => {
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(y, m, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const sumOf = (arr: number[] | undefined) => (arr ?? []).reduce((s, v) => s + v, 0)

export default function MonthlyPLPage() {
  const [result, setResult] = useState<MonthlyPLResult | null>(null)
  const [loading, setLoading] = useState(true)
  const now = new Date()
  const [monthFrom, setMonthFrom] = useState(() => monthStr(new Date(now.getFullYear(), now.getMonth() - 5, 1)))
  const [monthTo, setMonthTo]     = useState(() => monthStr(now))
  // 기본은 증빙 기준 (2026-11-03 사용자 결정)
  const [basis, setBasis] = useState<'evidence' | 'erp'>('evidence')
  const [msg, setMsg] = useState<string | null>(null)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    p.set('from', monthFrom)
    p.set('to', monthTo)
    p.set('basis', basis)
    const res  = await fetch(`/api/reports/monthly-pl?${p}`)
    const json = await res.json()
    if (res.ok) setResult(json)
    else { showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`); setResult(null) }
    setLoading(false)
  }, [monthFrom, monthTo, basis])

  useEffect(() => { load() }, [load])

  // KPI (기간 합계)
  const kpi = useMemo(() => {
    if (!result) return null
    const find = (k: string) => result.items.find(it => it.key === k)
    const revenue = sumOf((find('revenue_total') ?? find('revenue'))?.values)
    const cogs = sumOf((find('cogs_total') ?? find('cogs'))?.values)
    const gross = sumOf(find('gross_profit')?.values)
    const op = sumOf(find('operating_profit')?.values)
    const sga = sumOf(find('sga_total')?.values)
    const diff = result.reconcile ? sumOf(result.reconcile.diff) : null
    return { revenue, cogs, gross, op, sga, margin: revenue ? (gross / revenue) * 100 : 0, diff }
  }, [result])

  const ledgerHref = (accountId: string) => `/ledger?accountId=${accountId}&from=${monthFrom}-01&to=${lastDay(monthTo)}`

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">월별 손익현황 (경영관리용)</h1>
          <p className="text-sm mt-1 text-gray-500">
            {basis === 'evidence'
              ? '매출·매출원가는 홈택스 자료(매출 계산서·카드매출·현금영수증·상품매입 분개) 기준 — 부가세 신고와 같은 숫자입니다. 판매관리비 이하는 확정된 분개 기준입니다.'
              : '매출·매출원가는 ERP 주문 기준(취소·VIP·선결제 제외), 나머지 수익·비용은 확정된 분개 기준입니다. 거래처·담당·품목 분석용입니다.'}
            {' '}임대료수익은 임대사업자이므로 매출 구간에 들어갑니다.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm">
            <button onClick={() => setBasis('evidence')}
              className={`px-3 py-1.5 font-medium ${basis === 'evidence' ? 'bg-slate-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>증빙 기준</button>
            <button onClick={() => setBasis('erp')}
              className={`px-3 py-1.5 font-medium ${basis === 'erp' ? 'bg-slate-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>ERP 기준</button>
          </div>
          <input type="month" value={monthFrom} onChange={e => setMonthFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
          <span className="text-gray-400 text-sm">~</span>
          <input type="month" value={monthTo} onChange={e => setMonthTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
          <button onClick={() => { const a = document.createElement('a'); a.href = `/api/reports/monthly-pl/export?from=${monthFrom}&to=${monthTo}&basis=${basis}`; a.click() }}
            className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 whitespace-nowrap">↓ 엑셀</button>
        </div>
      </div>

      {/* 월 단위 기간 칩 — 누르면 월 입력 칸이 채워지고 바로 다시 조회된다 (2026-11-11 승인) */}
      <MonthPresets from={monthFrom} to={monthTo} onChange={(f, t) => { setMonthFrom(f); setMonthTo(t) }} className="mt-3" />

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {/* KPI (기간 합계) */}
      {kpi && !loading && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 my-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs text-gray-400">매출 ({basis === 'evidence' ? '증빙' : 'ERP'})</div>
            <div className="text-xl font-bold mt-1">{eok(kpi.revenue)}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs text-gray-400">매출원가</div>
            <div className="text-xl font-bold mt-1">{eok(kpi.cogs)}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs text-gray-400">매출이익률</div>
            <div className="text-xl font-bold mt-1">{kpi.margin.toFixed(1)}%</div>
            <div className="text-[0.6875rem] text-gray-400 mt-0.5">매출이익 {eok(kpi.gross)}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs text-gray-400">영업이익</div>
            <div className={`text-xl font-bold mt-1 ${kpi.op < 0 ? 'text-red-600' : ''}`}>{eok(kpi.op)}</div>
            <div className="text-[0.6875rem] text-gray-400 mt-0.5">판관비 {eok(kpi.sga)}</div>
          </div>
          {kpi.diff !== null ? (
            <div className={`border rounded-xl p-4 ${kpi.diff === 0 ? 'bg-white border-gray-200' : 'bg-amber-50 border-amber-300'}`}>
              <div className={`text-xs ${kpi.diff === 0 ? 'text-gray-400' : 'text-amber-700'}`}>ERP와 매출 차이 (ERP − 증빙)</div>
              <div className={`text-xl font-bold mt-1 ${kpi.diff === 0 ? '' : 'text-amber-800'}`}>{kpi.diff > 0 ? '+' : ''}{eok(kpi.diff)}</div>
              <div className={`text-[0.6875rem] mt-0.5 ${kpi.diff === 0 ? 'text-gray-400' : 'text-amber-700'}`}>아래 매출 대사 참조</div>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-xs text-gray-400">기준</div>
              <div className="text-sm font-medium mt-1 text-gray-700">ERP 주문일 기준</div>
              <div className="text-[0.6875rem] text-gray-400 mt-0.5">증빙 기준으로 바꾸면 대사가 보입니다</div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : !result || result.months.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">표시할 데이터가 없습니다.</div>
      ) : (
        <>
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium sticky left-0 bg-white">항목</th>
                {result.months.map(m => (
                  <th key={m} className="py-2.5 px-3 font-medium text-right whitespace-nowrap">{formatMonth(m)}</th>
                ))}
                <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap border-l border-gray-200 text-gray-500">합계</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map(item => item.is_section_header ? (
                <tr key={item.key} className="border-b border-gray-200 bg-slate-100">
                  <td className="py-1.5 px-3 text-xs font-semibold text-gray-500 tracking-wide sticky left-0 bg-slate-100">
                    {item.label}
                  </td>
                  {result.months.map(m => <td key={m} className="bg-slate-100" />)}
                  <td className="bg-slate-100 border-l border-gray-200" />
                </tr>
              ) : (
                <tr
                  key={item.key}
                  className={`border-b border-gray-100 ${item.is_subtotal ? 'bg-slate-50 font-medium text-gray-900' : 'text-gray-700'}`}
                >
                  <td className="py-2 px-3 whitespace-nowrap sticky left-0 bg-inherit">
                    {item.href ? (
                      <Link href={item.href} className="hover:text-blue-700 hover:underline" title="원본 화면으로 (드릴다운)">{item.label}</Link>
                    ) : item.account_id ? (
                      <Link
                        href={ledgerHref(item.account_id)}
                        className="hover:text-blue-700 hover:underline"
                        title="계정별 원장으로 (드릴다운)"
                      >
                        {item.label}
                      </Link>
                    ) : item.label}
                    {item.note && <span className="ml-2 text-[0.6875rem] font-normal text-amber-600">{item.note}</span>}
                  </td>
                  {item.values.map((v, i) => (
                    <td
                      key={result.months[i]}
                      className={`py-2 px-3 text-right whitespace-nowrap ${
                        item.is_placeholder
                          ? 'text-gray-300 italic'
                          : (item.is_subtotal && v < 0) || item.key === 'rev_dedupe'
                            ? 'text-red-600'
                            : ''
                      }`}
                    >
                      {item.is_placeholder ? '미반영' : won(v)}
                    </td>
                  ))}
                  {(() => {
                    const total = item.values.reduce((s, v) => s + v, 0)
                    return (
                      <td className={`py-2 px-3 text-right whitespace-nowrap font-medium border-l border-gray-200 ${
                        item.is_placeholder ? 'text-gray-300 italic font-normal' : total < 0 ? 'text-red-600' : ''
                      }`}>
                        {item.is_placeholder ? '미반영' : won(total)}
                      </td>
                    )
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 과세·면세별 매출이익 — 증빙 기준 (2026-11-12) */}
        {result.taxSplit && (() => {
          const ts = result.taxSplit
          const groups = [
            { key: 'taxable', title: '과세', row: ts.taxable },
            { key: 'exempt', title: '면세', row: ts.exempt },
            { key: 'other', title: '구분 없음', row: ts.other },
          ] as const
          const visible = groups.filter(g => g.key !== 'other' || g.row.revenue.some(v => v !== 0) || g.row.cogs.some(v => v !== 0))
          const rate = (r: TaxSplitRow) => { const rev = sumOf(r.revenue); return rev ? `${((sumOf(r.gross) / rev) * 100).toFixed(1)}%` : '-' }
          return (
            <div className="mt-8">
              <h2 className="text-base font-bold text-gray-900">과세 · 면세별 매출이익</h2>
              <p className="text-xs text-gray-500 mt-1">
                매출은 위 매출 행을 과세·면세로 모은 것이고(중복 제거분 포함), 원가는 상품매입 세금계산서(과세)·계산서(면세)입니다.
                카드매출 구분 미기재 건은 과세로 봅니다. 임대료수익 등 계정 행과 법인카드·통장·수동 분개 상품매입은 과세·면세를 알 수 없어 &lsquo;구분 없음&rsquo;에 둡니다.
              </p>
              <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto mt-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                      <th className="py-2.5 px-3 font-medium">항목</th>
                      {result.months.map(m => <th key={m} className="py-2.5 px-3 font-medium text-right whitespace-nowrap">{formatMonth(m)}</th>)}
                      <th className="py-2.5 px-3 font-semibold text-right border-l border-gray-200 text-gray-500">합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(g => (
                      <Fragment key={g.key}>
                        {([['매출', g.row.revenue, false], ['매출원가', g.row.cogs, false], ['매출이익', g.row.gross, true]] as const).map(([label, arr, isSub]) => (
                          <tr key={label} className={`border-b border-gray-100 ${isSub ? 'bg-slate-50 font-medium text-gray-900' : 'text-gray-700'}`}>
                            <td className="py-2 px-3 whitespace-nowrap">
                              {g.title} {label}
                              {isSub && <span className="ml-2 text-[0.6875rem] font-normal text-gray-400">이익률 {rate(g.row)}</span>}
                            </td>
                            {arr.map((v, i) => (
                              <td key={i} className={`py-2 px-3 text-right whitespace-nowrap ${isSub && v < 0 ? 'text-red-600' : ''}`}>{won(v)}</td>
                            ))}
                            <td className={`py-2 px-3 text-right whitespace-nowrap font-medium border-l border-gray-200 ${isSub && sumOf(arr) < 0 ? 'text-red-600' : ''}`}>{won(sumOf(arr))}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}

        {/* 매출 대사 — 증빙 vs ERP */}
        {result.reconcile && (
          <div className="mt-8">
            <h2 className="text-base font-bold text-gray-900">매출 대사 — 증빙 기준 vs ERP 기준</h2>
            <p className="text-xs text-gray-500 mt-1">
              차이가 양수면 ERP에만 있는 매출(계산서·현금영수증 미발행 후보), 음수면 증빙에만 있는 매출(ERP 미입력 후보)입니다.
              주문월과 발행월이 다른 시점 차이는 기간 합계에서 상쇄됩니다. 거래처 표는 상품 매출(계산서)만 대사하며 카드매출은 거래처가 없어 월 합계에만 들어갑니다.
            </p>
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto mt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                    <th className="py-2.5 px-3 font-medium">항목</th>
                    {result.months.map(m => <th key={m} className="py-2.5 px-3 font-medium text-right whitespace-nowrap">{formatMonth(m)}</th>)}
                    <th className="py-2.5 px-3 font-semibold text-right border-l border-gray-200 text-gray-500">합계</th>
                  </tr>
                </thead>
                <tbody>
                  {([['매출 (증빙 기준)', result.reconcile.evidence, false], ['매출 (ERP 기준, 주문일)', result.reconcile.erp, false], ['차이 (ERP − 증빙)', result.reconcile.diff, true]] as const).map(([label, arr, isDiff]) => (
                    <tr key={label} className={`border-b border-gray-100 ${isDiff ? 'bg-slate-50 font-medium' : ''}`}>
                      <td className="py-2 px-3 whitespace-nowrap">{label}</td>
                      {arr.map((v, i) => (
                        <td key={i} className={`py-2 px-3 text-right whitespace-nowrap ${isDiff && v !== 0 ? 'text-amber-700' : ''}`}>{isDiff && v > 0 ? '+' : ''}{won(v)}</td>
                      ))}
                      <td className={`py-2 px-3 text-right whitespace-nowrap font-medium border-l border-gray-200 ${isDiff && sumOf(arr) !== 0 ? 'text-amber-700' : ''}`}>{isDiff && sumOf(arr) > 0 ? '+' : ''}{won(sumOf(arr))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {result.reconcile.vendors.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto mt-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                      <th className="py-2.5 px-3 font-medium">거래처 (차이 큰 순, 상위 {result.reconcile.vendors.length})</th>
                      <th className="py-2.5 px-3 font-medium text-right">ERP 순매출</th>
                      <th className="py-2.5 px-3 font-medium text-right">증빙 매출 (계산서)</th>
                      <th className="py-2.5 px-3 font-medium text-right">차이</th>
                      <th className="py-2.5 px-3 font-medium text-right">주문 / 계산서</th>
                      <th className="py-2.5 px-3 font-medium">보기</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.reconcile.vendors.map(v => (
                      <tr key={v.vendor_id ?? 'none'} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-3">{v.vendor_name || '(이름 없음)'}</td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">{won(v.erp)}</td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">{won(v.evidence)}</td>
                        <td className={`py-2 px-3 text-right whitespace-nowrap font-medium ${v.diff > 0 ? 'text-amber-700' : 'text-sky-700'}`}>{v.diff > 0 ? '+' : ''}{won(v.diff)}</td>
                        <td className="py-2 px-3 text-right whitespace-nowrap text-gray-500">{v.erp_orders} / {v.invoices}</td>
                        <td className="py-2 px-3 text-xs whitespace-nowrap">
                          {v.vendor_id && (
                            <>
                              <Link href={`/sales-hub/${v.vendor_id}`} className="text-sky-700 hover:underline">매출처 상세</Link>
                              <span className="text-gray-300 mx-1">·</span>
                              <Link href={`/tax-invoices?dir=sales&tax=taxable`} className="text-sky-700 hover:underline">계산서</Link>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-3 mt-6 text-xs">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="font-semibold text-gray-700 mb-2">증빙 기준 — 인식 시점과 원천</div>
            <ul className="space-y-1 text-gray-600">
              <li>· 매출 세금계산서·계산서: 작성일, 공급가액 (매출 4001 또는 미분류 건만 — 임대료수익 등은 계정별 행)</li>
              <li>· 카드매출: 승인일, 승인 − 취소, 공급가액. 세액 있음 = 과세, 세액 0 = 면세, 구분 미기재(공급가·세액 없음) = 과세로 보고 1.1로 나눔</li>
              <li>· 현금영수증 매출: 거래일, 승인 − 취소, 공급가액. 세액 0이면 면세. 같은 사업자번호·금액·7일 안의 매출 계산서가 있으면 중복으로 뺌</li>
              <li>· 상품매입: 5002로 확정된 세금계산서·법인카드 분개 (작성일·이용일). 계산서는 원본의 과세·면세로 나눔, 법인카드는 나누지 않음</li>
              <li>· 부가세 신고 합계표와 같은 숫자가 나와야 정상 — 다르면 업로드 누락</li>
            </ul>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="font-semibold text-gray-700 mb-2">한계 · 역할 분담</div>
            <ul className="space-y-1 text-gray-600">
              <li>· 사장님 보고·세무사 대사 = 증빙 기준 / 거래처·담당·품목 분석 = ERP 기준</li>
              <li>· 매출원가는 재고 실사가 없어 당월 매입으로 봅니다 (재고가 늘어난 달은 원가가 커 보임)</li>
              <li>· 증빙 없는 매출(계좌이체만 받고 미발행)은 빠집니다 — 대사 표의 양수 차이로 관리</li>
              <li>· 급여·감가상각·법인세는 분개가 생기기 전까지 두 기준 모두 미반영</li>
            </ul>
          </div>
        </div>
        </>
      )}
    </div>
  )
}
