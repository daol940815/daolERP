'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { getPeriodRange, PERIOD_PRESETS } from '@/lib/period-presets'

const won = (n: number | null | undefined) => (n ?? 0).toLocaleString('ko-KR')

const TYPE_LABEL: Record<string, string> = {
  asset: '자산', liability: '부채', equity: '자본', income: '수익', expense: '비용',
}

interface AccountOpt { id: string; code: string | null; name: string; type: string; line_count: number }
interface Row {
  entry_date: string
  entry_no: string
  description: string | null
  counterpart: string | null
  vendor: string | null
  debit: number
  credit: number
  balance: number
  note: string | null
  source_type?: string | null   // 059 마이그레이션 이후 제공 (드릴다운)
  source_id?: string | null
}

const SOURCE_LABEL: Record<string, string> = {
  bank: '통장', card: '카드', card_sale: '카드매출', tax_invoice: '세계', manual: '수동',
}
interface Ledger {
  account: { id: string; code: string | null; name: string; type: string }
  opening: number
  rows: Row[]
  total_debit: number
  total_credit: number
  closing: number
}

function AccountLedgerContent() {
  const searchParams = useSearchParams()
  const [accounts, setAccounts] = useState<AccountOpt[]>([])
  // 손익현황 등에서 드릴다운 진입 시 URL 파라미터로 계정·기간을 받는다
  const [accountId, setAccountId] = useState(() => searchParams.get('accountId') ?? '')
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const [dateFrom, setDateFrom] = useState(() => searchParams.get('from') || getPeriodRange('당월').from)
  const [dateTo, setDateTo]     = useState(() => searchParams.get('to') || getPeriodRange('당월').to)

  // 계정 목록 로드
  useEffect(() => {
    fetch('/api/ledger/account')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.accounts)) {
          setAccounts(d.accounts)
          if (d.accounts.length > 0) setAccountId(prev => prev || d.accounts[0].id)
        }
      })
      .catch(() => setMsg('계정 목록을 불러오지 못했습니다.'))
  }, [])

  const load = useCallback(async () => {
    if (!accountId) { setLedger(null); return }
    setLoading(true)
    const p = new URLSearchParams({ accountId, from: dateFrom, to: dateTo })
    const res = await fetch(`/api/ledger/account?${p}`)
    const json = await res.json()
    if (res.ok && json.account) setLedger(json)
    else { setLedger(null); setMsg(`조회 실패: ${json.error ?? '오류'}`); setTimeout(() => setMsg(null), 4000) }
    setLoading(false)
  }, [accountId, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  // 월별 소계(월계) 삽입을 위해 행을 가공
  const display = useMemo(() => {
    if (!ledger) return [] as ({ kind: 'row'; r: Row } | { kind: 'subtotal'; ym: string; debit: number; credit: number })[]
    const out: ({ kind: 'row'; r: Row } | { kind: 'subtotal'; ym: string; debit: number; credit: number })[] = []
    let curYm = ''
    let sd = 0, sc = 0
    const flush = () => { if (curYm) out.push({ kind: 'subtotal', ym: curYm, debit: sd, credit: sc }) }
    for (const r of ledger.rows) {
      const ym = r.entry_date.slice(0, 7)
      if (ym !== curYm) { flush(); curYm = ym; sd = 0; sc = 0 }
      out.push({ kind: 'row', r }); sd += r.debit; sc += r.credit
    }
    flush()
    return out
  }, [ledger])

  const selected = accounts.find(a => a.id === accountId)
  const multiMonth = ledger ? new Set(ledger.rows.map(r => r.entry_date.slice(0, 7))).size > 1 : false

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">계정별 원장</h1>
      <p className="text-sm mt-1 text-gray-500">분개장을 원천으로 계정별 거래내역과 잔액 누계를 확인합니다.</p>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {/* 기간 빠른 선택 */}
      <div className="flex flex-wrap items-center gap-1 mb-2 mt-3">
        {PERIOD_PRESETS.map(p => (
          <button key={p} onClick={() => { const r = getPeriodRange(p); setDateFrom(r.from); setDateTo(r.to) }}
            className="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-slate-100 hover:border-slate-400 transition-colors">
            {p}
          </button>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select value={accountId} onChange={e => setAccountId(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm min-w-[240px]">
          {accounts.length === 0 && <option value="">분개된 계정이 없습니다</option>}
          {accounts.map(a => (
            <option key={a.id} value={a.id}>
              {a.code ? `${a.code} · ` : ''}{a.name} ({TYPE_LABEL[a.type] ?? a.type})
            </option>
          ))}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <button onClick={() => {
          if (!accountId) return
          const a = document.createElement('a')
          a.href = `/api/ledger/account/export?accountId=${accountId}&from=${dateFrom}&to=${dateTo}`; a.click()
        }} disabled={!ledger}
          className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap">
          ↓ 엑셀
        </button>
      </div>

      {/* 요약 */}
      {ledger && (
        <div className="flex gap-3 flex-wrap mb-3">
          <SummaryBox label="전월이월" value={won(ledger.opening)} />
          <SummaryBox label="기간 차변" value={won(ledger.total_debit)} accent="blue" />
          <SummaryBox label="기간 대변" value={won(ledger.total_credit)} accent="red" />
          <SummaryBox label="기말잔액" value={won(ledger.closing)} accent="dark" />
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : !ledger ? (
        <div className="text-center py-20 text-gray-400 text-sm">계정을 선택하면 원장이 표시됩니다.</div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium w-24">일자</th>
                <th className="py-2 px-2 text-left font-medium">적요</th>
                <th className="py-2 px-2 text-left font-medium">상대계정</th>
                <th className="py-2 px-2 text-left font-medium">거래처</th>
                <th className="py-2 px-3 text-right font-medium w-28">차변</th>
                <th className="py-2 px-3 text-right font-medium w-28">대변</th>
                <th className="py-2 px-3 text-right font-medium w-32">잔액</th>
                <th className="py-2 px-3 text-left font-medium w-32">전표번호</th>
              </tr>
            </thead>
            <tbody>
              {/* 전월이월 */}
              <tr className="bg-amber-50/60 border-b border-gray-100 text-gray-600">
                <td className="py-1.5 px-3" colSpan={4}>[전월이월]</td>
                <td className="py-1.5 px-3 text-right text-gray-300">-</td>
                <td className="py-1.5 px-3 text-right text-gray-300">-</td>
                <td className="py-1.5 px-3 text-right font-medium">{won(ledger.opening)}</td>
                <td></td>
              </tr>

              {ledger.rows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">해당 기간 거래가 없습니다.</td></tr>
              ) : display.map((item, i) =>
                item.kind === 'row' ? (
                  <tr key={`r${i}`} className="border-b border-gray-50 hover:bg-slate-50/60">
                    <td className="py-1.5 px-3 whitespace-nowrap text-gray-600">{item.r.entry_date}</td>
                    <td className="py-1.5 px-2 text-gray-800">{item.r.description ?? ''}</td>
                    <td className="py-1.5 px-2 text-gray-500">{item.r.counterpart ?? ''}</td>
                    <td className="py-1.5 px-2 text-gray-500">{item.r.vendor ?? ''}</td>
                    <td className="py-1.5 px-3 text-right text-blue-700 whitespace-nowrap">{item.r.debit ? won(item.r.debit) : ''}</td>
                    <td className="py-1.5 px-3 text-right text-red-700 whitespace-nowrap">{item.r.credit ? won(item.r.credit) : ''}</td>
                    <td className={`py-1.5 px-3 text-right whitespace-nowrap ${item.r.balance < 0 ? 'text-red-600' : 'text-gray-800'}`}>{won(item.r.balance)}</td>
                    <td className="py-1.5 px-3 font-mono text-xs text-gray-400 whitespace-nowrap">
                      {item.r.entry_no}
                      {item.r.source_type && item.r.source_type !== 'manual' && item.r.source_id && (
                        <Link
                          href={`/source/${item.r.source_type}/${item.r.source_id}`}
                          className="ml-1.5 px-1 py-0.5 rounded bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 font-sans"
                          title="원본 레코드 보기"
                        >
                          {SOURCE_LABEL[item.r.source_type] ?? '원본'}↗
                        </Link>
                      )}
                    </td>
                  </tr>
                ) : multiMonth ? (
                  <tr key={`s${i}`} className="bg-slate-50 border-b border-gray-100 text-gray-500 text-xs">
                    <td className="py-1.5 px-3" colSpan={4}>[{item.ym} 월계]</td>
                    <td className="py-1.5 px-3 text-right text-blue-700">{won(item.debit)}</td>
                    <td className="py-1.5 px-3 text-right text-red-700">{won(item.credit)}</td>
                    <td colSpan={2}></td>
                  </tr>
                ) : null
              )}

              {/* 누계 */}
              <tr className="bg-slate-100 border-t-2 border-slate-300 font-semibold text-gray-800">
                <td className="py-2 px-3" colSpan={4}>[누계]</td>
                <td className="py-2 px-3 text-right text-blue-700">{won(ledger.total_debit)}</td>
                <td className="py-2 px-3 text-right text-red-700">{won(ledger.total_credit)}</td>
                <td className={`py-2 px-3 text-right ${ledger.closing < 0 ? 'text-red-600' : ''}`}>{won(ledger.closing)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <p className="text-xs text-gray-400 mt-2">
          {selected.code ? `${selected.code} · ` : ''}{selected.name} · 전체 분개 라인 {selected.line_count.toLocaleString()}건
          · 잔액 부호: {['asset', 'expense'].includes(selected.type) ? '차변(+)' : '대변(+)'} 기준
        </p>
      )}
    </div>
  )
}

// useSearchParams는 Suspense 경계 필요 — 손익현황 드릴다운 진입(?accountId&from&to) 지원
export default function AccountLedgerPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400 text-sm">로딩 중...</div>}>
      <AccountLedgerContent />
    </Suspense>
  )
}

function SummaryBox({ label, value, accent }: { label: string; value: string; accent?: 'blue' | 'red' | 'dark' }) {
  const cls = accent === 'blue' ? 'text-blue-700' : accent === 'red' ? 'text-red-700' : accent === 'dark' ? 'text-gray-900' : 'text-gray-700'
  return (
    <div className="border border-gray-200 rounded-lg px-4 py-2.5 flex-1 min-w-[140px]">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className={`text-base font-bold ${cls}`}>{value}<span className="text-xs font-normal text-gray-400">원</span></p>
    </div>
  )
}
