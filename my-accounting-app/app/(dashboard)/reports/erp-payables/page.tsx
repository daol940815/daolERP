'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ErpPayableRow, ErpOrderItem } from '@/types/erp'
import SearchableSelect from '@/components/ui/SearchableSelect'

interface Vendor { id: string; name: string }

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

function monthAdd(month: string, diff: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + diff, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const thisMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function ErpPayablesPage() {
  const [rows, setRows]         = useState<ErpPayableRow[]>([])
  const [vendors, setVendors]   = useState<Vendor[]>([])
  const [loading, setLoading]   = useState(true)
  const [exporting, setExporting] = useState(false)
  const [search, setSearch]     = useState('')
  const [monthFrom, setMonthFrom] = useState(monthAdd(thisMonth(), -2))
  const [monthTo, setMonthTo]     = useState(thisMonth())
  const [statusFilter, setStatusFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [groupItems, setGroupItems] = useState<ErpOrderItem[]>([])
  const [msg, setMsg]           = useState<string | null>(null)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 5000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (monthFrom) p.set('monthFrom', monthFrom)
    if (monthTo)   p.set('monthTo', monthTo)
    const res  = await fetch(`/api/reports/erp-payables?${p}`)
    const json = await res.json()
    if (Array.isArray(json.data)) setRows(json.data)
    else showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`)
    setExpanded(null)
    setLoading(false)
  }, [monthFrom, monthTo])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/vendors?all=true')
      .then(r => r.json())
      .then(d => { if (d.data) setVendors(d.data) })
      .catch(() => null)
  }, [])

  const handleExport = useCallback(() => {
    setExporting(true)
    const p = new URLSearchParams()
    if (monthFrom) p.set('monthFrom', monthFrom)
    if (monthTo)   p.set('monthTo', monthTo)
    const a = document.createElement('a')
    a.href = `/api/reports/erp-payables/export?${p}`
    a.click()
    setExporting(false)
  }, [monthFrom, monthTo])

  const loadGroupItems = async (row: ErpPayableRow) => {
    const key = `${row.alias_id}|${row.settlement_month}`
    if (expanded === key) { setExpanded(null); return }
    setExpanded(key)
    setGroupItems([])
    const res  = await fetch(`/api/erp-items?aliasId=${row.alias_id}&month=${row.settlement_month}`)
    const json = await res.json()
    if (res.ok && Array.isArray(json.data)) setGroupItems(json.data)
  }

  const handlePay = async (row: ErpPayableRow) => {
    const input = window.prompt(
      `[결제완료 처리] ${row.erp_name} / ${row.settlement_month}\n실제 결제액을 입력하세요. (품목 합계: ${won(row.purchase_total)})\n품목 합계와 다르면 차액이 표시됩니다.`,
      String(row.purchase_total),
    )
    if (input === null) return
    const paidAmount = Math.round(Number(input.replace(/,/g, '')))
    if (!Number.isFinite(paidAmount) || paidAmount < 0) { showMsg('금액이 올바르지 않습니다.'); return }

    let usePrepay = false
    if (row.payment_term === 'advance' || row.prepay_balance > 0) {
      usePrepay = window.confirm(`선입금 잔액(${won(row.prepay_balance)})에서 차감 처리할까요?\n[확인]=선입금 차감 / [취소]=일반 결제`)
    }

    const res = await fetch('/api/erp-settlements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        purchase_alias_id: row.alias_id,
        settlement_month: row.settlement_month,
        action: 'pay',
        paid_amount: paidAmount,
        use_prepayment: usePrepay,
      }),
    })
    const json = await res.json()
    if (!res.ok) { showMsg(`처리 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    showMsg(json.warning ? `결제완료 처리됨 (경고: ${json.warning})` : '결제완료 처리됨')
    load()
  }

  const handleUnpay = async (row: ErpPayableRow) => {
    if (!window.confirm(`${row.erp_name} / ${row.settlement_month} 정산을 미결제로 되돌리시겠습니까?\n선입금 차감 내역도 함께 취소됩니다.`)) return
    const res = await fetch('/api/erp-settlements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        purchase_alias_id: row.alias_id,
        settlement_month: row.settlement_month,
        action: 'unpay',
      }),
    })
    const json = await res.json()
    if (!res.ok) { showMsg(`처리 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    showMsg('미결제로 되돌렸습니다.')
    load()
  }

  const handleMoveItem = async (item: ErpOrderItem) => {
    const target = window.prompt(
      `[정산월 이월] ${item.item_name}\n이동할 정산월을 입력하세요. (YYYY-MM)`,
      monthAdd(item.settlement_month ?? thisMonth(), 1),
    )
    if (target === null) return
    if (!/^\d{4}-\d{2}$/.test(target)) { showMsg('YYYY-MM 형식으로 입력해주세요.'); return }
    const res = await fetch('/api/erp-settlements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_ids: [item.id], settlement_month: target }),
    })
    const json = await res.json()
    if (!res.ok) { showMsg(`이월 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    showMsg(`${target} 정산으로 이월되었습니다.`)
    load()
  }

  const handleDeposit = async (row: ErpPayableRow) => {
    const input = window.prompt(`[선입금 등록] ${row.erp_name}\n매입처에 선입금한 금액을 입력하세요.`, '')
    if (input === null) return
    const amount = Math.round(Number(input.replace(/,/g, '')))
    if (!Number.isFinite(amount) || amount <= 0) { showMsg('금액이 올바르지 않습니다.'); return }
    const res = await fetch('/api/erp-prepayments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        direction: 'purchase',
        alias_id: row.alias_id,
        entry_date: new Date().toISOString().slice(0, 10),
        entry_type: 'deposit',
        amount,
        memo: '선입금 등록',
      }),
    })
    const json = await res.json()
    if (!res.ok) { showMsg(`등록 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    showMsg(`${won(amount)} 선입금 등록 완료`)
    load()
  }

  const handleLinkVendor = async (row: ErpPayableRow, vendorId: string) => {
    const res  = await fetch('/api/erp-aliases', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.alias_id, vendor_id: vendorId || null }),
    })
    const json = await res.json()
    if (!res.ok) { showMsg(`연결 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    const vendorName = vendors.find(v => v.id === vendorId)?.name ?? null
    setRows(prev => prev.map(r => r.alias_id === row.alias_id
      ? { ...r, vendor_id: vendorId || null, vendor_name: vendorName }
      : r))
    showMsg(vendorId ? '거래처 연결 완료' : '거래처 연결 해제')
  }

  const handleTermChange = async (row: ErpPayableRow, term: string) => {
    const res  = await fetch('/api/erp-aliases', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.alias_id, payment_term: term }),
    })
    const json = await res.json()
    if (!res.ok) { showMsg(`변경 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    setRows(prev => prev.map(r => r.alias_id === row.alias_id
      ? { ...r, payment_term: term as ErpPayableRow['payment_term'] }
      : r))
  }

  const q = search.trim()
  let filtered = q
    ? rows.filter(r => r.erp_name.includes(q) || (r.vendor_name ?? '').includes(q))
    : rows
  if (statusFilter !== 'all') filtered = filtered.filter(r => r.status === statusFilter)

  const totalPurchase = filtered.reduce((s, r) => s + r.purchase_total, 0)
  const totalUnpaid   = filtered.filter(r => r.status === 'unpaid').reduce((s, r) => s + r.purchase_total, 0)

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-1 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ERP 매입처별 결제현황</h1>
          <p className="text-sm mt-1 text-orange-700 font-medium">매입처 × 정산월 단위 미결제 관리 · 취소/VIP/선결제 제외 · 정산월 이월 가능</p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || loading || filtered.length === 0}
          className="px-3 py-2 border border-emerald-300 rounded-lg text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 flex items-center gap-1.5"
        >
          ↓ {exporting ? '다운로드 중...' : '엑셀 다운로드'}
        </button>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {/* 필터 */}
      <div className="flex items-center gap-2 mb-4 mt-3 flex-wrap">
        <input type="month" value={monthFrom} onChange={e => setMonthFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="month" value={monthTo} onChange={e => setMonthTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900">
          <option value="all">전체</option>
          <option value="unpaid">미결제</option>
          <option value="paid">결제완료</option>
        </select>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="매입처명 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
      </div>

      {/* 요약 카드 */}
      <div className="flex gap-3 flex-wrap mb-5">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">매입액 합계</p>
          <p className="text-lg font-bold text-gray-900">{won(totalPurchase)}</p>
          <p className="text-xs text-gray-400">{filtered.length}개 정산 그룹</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">미결제 합계</p>
          <p className={`text-lg font-bold ${totalUnpaid > 0 ? 'text-red-600' : 'text-gray-400'}`}>{won(totalUnpaid)}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">표시할 데이터가 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium">정산월</th>
                <th className="py-2.5 px-3 font-medium">매입처 (ERP)</th>
                <th className="py-2.5 px-3 font-medium">연결 거래처</th>
                <th className="py-2.5 px-3 font-medium">결제방식</th>
                <th className="py-2.5 px-3 font-medium text-right">매입액</th>
                <th className="py-2.5 px-3 font-medium text-right">실제결제 / 차액</th>
                <th className="py-2.5 px-3 font-medium text-right">선입금잔액</th>
                <th className="py-2.5 px-3 font-medium">상태</th>
                <th className="py-2.5 px-3 font-medium text-right">액션</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const key  = `${r.alias_id}|${r.settlement_month}`
                const diff = r.paid_amount != null ? r.paid_amount - r.purchase_total : null
                return [
                  <tr key={key} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 whitespace-nowrap text-gray-600 font-mono text-xs">{r.settlement_month}</td>
                    <td className="py-2 px-3 min-w-0">
                      <button onClick={() => loadGroupItems(r)} className="truncate max-w-[180px] text-gray-900 hover:underline text-left">
                        {expanded === key ? '▾' : '▸'} {r.erp_name}
                      </button>
                      <span className="text-xs text-gray-400 ml-1">({r.item_count})</span>
                    </td>
                    <td className="py-2 px-3">
                      <SearchableSelect
                        value={r.vendor_id ?? ''}
                        onChange={id => handleLinkVendor(r, id)}
                        options={vendors.map(v => ({ id: v.id, label: v.name }))}
                        emptyLabel="미연결"
                        className={`border rounded px-2 py-1 text-xs w-40 ${r.vendor_id ? 'border-gray-200 text-gray-700' : 'border-amber-300 text-amber-600 bg-amber-50'}`}
                      />
                    </td>
                    <td className="py-2 px-3">
                      <select
                        value={r.payment_term}
                        onChange={e => handleTermChange(r, e.target.value)}
                        className="border border-gray-200 rounded px-2 py-1 text-xs"
                      >
                        <option value="monthly">월말정산</option>
                        <option value="advance">선입금</option>
                      </select>
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">{won(r.purchase_total)}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap text-xs">
                      {r.paid_amount != null ? (
                        <>
                          {won(r.paid_amount)}
                          {diff !== null && diff !== 0 && (
                            <span className={`ml-1 ${diff > 0 ? 'text-orange-600' : 'text-blue-600'}`}>
                              ({diff > 0 ? '+' : ''}{diff.toLocaleString()})
                            </span>
                          )}
                        </>
                      ) : '-'}
                    </td>
                    <td className={`py-2 px-3 text-right whitespace-nowrap ${r.prepay_balance > 0 ? 'text-sky-600' : 'text-gray-400'}`}>
                      {won(r.prepay_balance)}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {r.status === 'paid'
                        ? <span className="px-1.5 py-0.5 rounded text-xs bg-green-50 text-green-700">결제완료{r.paid_date ? ` ${r.paid_date.slice(5)}` : ''}</span>
                        : <span className="px-1.5 py-0.5 rounded text-xs bg-red-50 text-red-600">미결제</span>}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <button onClick={() => handleDeposit(r)}
                        className="px-2 py-1 text-xs border border-sky-300 text-sky-700 rounded hover:bg-sky-50 mr-1">
                        선입금
                      </button>
                      {r.status === 'unpaid' ? (
                        <button onClick={() => handlePay(r)}
                          className="px-2 py-1 text-xs border border-green-400 text-green-700 rounded hover:bg-green-50">
                          결제완료
                        </button>
                      ) : (
                        <button onClick={() => handleUnpay(r)}
                          className="px-2 py-1 text-xs border border-gray-300 text-gray-500 rounded hover:bg-gray-50">
                          되돌리기
                        </button>
                      )}
                    </td>
                  </tr>,
                  expanded === key && (
                    <tr key={`${key}-items`} className="bg-slate-50 border-b border-gray-100">
                      <td colSpan={9} className="py-2 px-6">
                        {groupItems.length === 0 ? (
                          <p className="text-xs text-gray-400 py-2">품목 로딩 중...</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-gray-400">
                                <th className="py-1 pr-3 font-medium">품명</th>
                                <th className="py-1 pr-3 font-medium text-right">수량</th>
                                <th className="py-1 pr-3 font-medium text-right">매입액</th>
                                <th className="py-1 pr-3 font-medium">정산월</th>
                                <th className="py-1 font-medium text-right">이월</th>
                              </tr>
                            </thead>
                            <tbody>
                              {groupItems.map(it => (
                                <tr key={it.id} className="border-t border-gray-200 text-gray-700">
                                  <td className="py-1 pr-3 max-w-[300px] truncate">{it.item_name ?? '-'}</td>
                                  <td className="py-1 pr-3 text-right">{it.quantity}</td>
                                  <td className="py-1 pr-3 text-right whitespace-nowrap">{won(it.purchase_total)}</td>
                                  <td className="py-1 pr-3 whitespace-nowrap">{it.settlement_month}</td>
                                  <td className="py-1 text-right">
                                    <button onClick={() => handleMoveItem(it)}
                                      className="px-1.5 py-0.5 border border-gray-300 rounded text-gray-500 hover:bg-gray-100">
                                      이월 →
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
