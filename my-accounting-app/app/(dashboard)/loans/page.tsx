'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AnnualReport from './annual-report'

const won = (n: number | null | undefined) => (n ?? 0).toLocaleString('ko-KR')
const eok = (n: number) => `${(n / 1e8).toFixed(2)}억`
const manwon = (n: number) => `${Math.round(n / 1e4).toLocaleString('ko-KR')}만`

interface BankAccount { id: string; bank_name: string; account_number: string | null }
interface Overdraft {
  bank_account_id: string
  overdraft_limit: number | null
  overdraft_used: number
  overdraft_available: number
  balance_date: string | null
}
interface Loan {
  id: string
  seq: number | null
  bank_name: string
  title: string
  bank_account_id: string | null
  bank_accounts: { bank_name: string; account_number: string | null } | null
  original_amount: number
  current_balance: number
  balance_date: string | null
  interest_rate: number | null
  rate_note: string | null
  monthly_principal: number
  monthly_interest: number
  payment_day: number | null
  start_date: string | null
  maturity_date: string | null
  term_type: 'short' | 'long'
  status: 'active' | 'unused' | 'closed'
  product_type?: 'term' | 'credit_line'
  credit_limit?: number
  memo: string | null
}

const STATUS_LABEL: Record<Loan['status'], string> = { active: '상환 중', unused: '미사용', closed: '종결' }
const TERM_LABEL: Record<Loan['term_type'], string> = { short: '단기', long: '장기' }

const acctLabel = (b: { bank_name: string; account_number: string | null } | null) =>
  b ? `${b.bank_name.replace('은행', '')} …${(b.account_number ?? '').slice(-4)}` : '-'

const today = () => new Date().toISOString().slice(0, 10)
const isCreditLine = (l: Loan) => (l.product_type ?? 'term') === 'credit_line'

// 마이너스 통장 이자 = 사용액 x 연이율 / 365 x 사용일수 (일할 후취)
// 화면에는 "현재 사용액이 당월 내내 유지된다고 가정한" 예상 월 이자를 표시한다.
const daysInThisMonth = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}
const estMonthlyInterest = (used: number, rate: number | null) =>
  !used || rate == null ? 0 : Math.round((used * (rate / 100) / 365) * daysInThisMonth())
const estDailyInterest = (used: number, rate: number | null) =>
  !used || rate == null ? 0 : Math.round(used * (rate / 100) / 365)

type EditForm = {
  title: string; bank_name: string; bank_account_id: string
  product_type: string; credit_limit: string
  current_balance: string; balance_date: string; interest_rate: string
  monthly_principal: string; monthly_interest: string; payment_day: string
  start_date: string; maturity_date: string; term_type: string; status: string; memo: string
}

const emptyForm: EditForm = {
  title: '', bank_name: '', bank_account_id: '', product_type: 'term', credit_limit: '0',
  current_balance: '', balance_date: today(), interest_rate: '', monthly_principal: '0',
  monthly_interest: '0', payment_day: '', start_date: '', maturity_date: '',
  term_type: 'long', status: 'active', memo: '',
}

export default function LoansPage() {
  const [loans, setLoans] = useState<Loan[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [overdrafts, setOverdrafts] = useState<Overdraft[]>([])
  const [migrationOk, setMigrationOk] = useState(true)
  const [migration404, setMigration404] = useState(true)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [msg, setMsg] = useState<string | null>(null)
  const [editing, setEditing] = useState<Loan | 'new' | null>(null)
  const [form, setForm] = useState<EditForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'list' | 'report'>('list')

  // 탭 상태를 주소(?tab=report)와 맞춘다 — 새로고침·북마크에서 유지
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t === 'report') setTab('report')
  }, [])
  const goTab = (t: 'list' | 'report') => {
    setTab(t)
    const url = t === 'report' ? '/loans?tab=report' : '/loans'
    window.history.replaceState(null, '', url)
  }

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/loans')
    const json = await res.json()
    if (res.ok) {
      setLoans(json.loans ?? [])
      setBankAccounts(json.bankAccounts ?? [])
      setOverdrafts(json.overdrafts ?? [])
      setMigrationOk(json.migration402 !== false)
      setMigration404(json.migration404 !== false)
    } else showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const odByAccount = useMemo(
    () => new Map(overdrafts.map(o => [o.bank_account_id, o])), [overdrafts])

  // 한도대출 사용액·미사용 한도는 통장 원본에서 산출 (loans에는 저장하지 않음)
  const usage = (l: Loan) => {
    const od = l.bank_account_id ? odByAccount.get(l.bank_account_id) : undefined
    const limit = l.credit_limit || (od?.overdraft_limit ? Math.abs(od.overdraft_limit) : 0)
    const used = od?.overdraft_used ?? 0
    return { limit, used, available: Math.max(limit - used, 0), linked: !!od, balance_date: od?.balance_date ?? null }
  }

  const needsCheck = (l: Loan) => !!l.memo && l.memo.includes('확인 필요')
  const isOverdue = (l: Loan) => !!l.maturity_date && l.maturity_date < today() && l.status === 'active'

  const terms = loans.filter(l => !isCreditLine(l))
  const lines = loans.filter(l => isCreditLine(l))
  // 연간 리포트에는 한도대출의 통장 기준 사용액을 함께 넘긴다
  const reportLoans = loans.map(l => ({ ...l, usage: isCreditLine(l) ? usage(l) : undefined }))

  const matchFilter = (l: Loan) => {
    if (filter === 'all') return true
    if (filter === 'check') return needsCheck(l) || isOverdue(l)
    const [kind, v] = filter.split(':')
    if (kind === 'bank') return l.bank_name === v
    if (kind === 'status') return l.status === v
    return true
  }
  const visibleTerms = terms.filter(matchFilter)
  const visibleLines = lines.filter(matchFilter)

  const activeTerms = terms.filter(l => l.status === 'active')
  const kpi = {
    balance: activeTerms.reduce((s, l) => s + l.current_balance, 0),
    original: terms.filter(l => l.status !== 'closed').reduce((s, l) => s + l.original_amount, 0),
    principal: activeTerms.reduce((s, l) => s + l.monthly_principal, 0),
    interest: activeTerms.reduce((s, l) => s + l.monthly_interest, 0),
    check: loans.filter(l => needsCheck(l) || isOverdue(l)).length,
    limit: lines.filter(l => l.status !== 'closed').reduce((s, l) => s + usage(l).limit, 0),
    used: lines.filter(l => l.status !== 'closed').reduce((s, l) => s + usage(l).used, 0),
    lineInterest: lines.filter(l => l.status !== 'closed')
      .reduce((s, l) => s + estMonthlyInterest(usage(l).used, l.interest_rate), 0),
  }
  kpi.check = loans.filter(l => needsCheck(l) || isOverdue(l)).length
  const banks = Array.from(new Set(loans.map(l => l.bank_name)))

  const openEdit = (l: Loan | 'new', preset?: 'term' | 'credit_line') => {
    setEditing(l)
    if (l === 'new') { setForm({ ...emptyForm, product_type: preset ?? 'term' }); return }
    setForm({
      title: l.title, bank_name: l.bank_name, bank_account_id: l.bank_account_id ?? '',
      product_type: l.product_type ?? 'term',
      credit_limit: String(l.credit_limit ?? 0),
      current_balance: String(l.current_balance ?? 0),
      balance_date: l.balance_date ?? today(),
      interest_rate: l.interest_rate != null ? String(l.interest_rate) : '',
      monthly_principal: String(l.monthly_principal ?? 0),
      monthly_interest: String(l.monthly_interest ?? 0),
      payment_day: l.payment_day != null ? String(l.payment_day) : '',
      start_date: l.start_date ?? '', maturity_date: l.maturity_date ?? '',
      term_type: l.term_type, status: l.status, memo: l.memo ?? '',
    })
  }

  const save = async () => {
    if (!form.title.trim() || !form.bank_name.trim()) { showMsg('대출명과 은행명을 입력해 주세요.'); return }
    setSaving(true)
    const num = (s: string) => Math.round(Number(String(s).replace(/,/g, '')) || 0)
    const creditLine = form.product_type === 'credit_line'
    const body = {
      title: form.title.trim(), bank_name: form.bank_name.trim(),
      bank_account_id: form.bank_account_id || null,
      product_type: form.product_type,
      credit_limit: creditLine ? num(form.credit_limit) : 0,
      // 한도대출의 잔액·월 원금은 저장하지 않는다 (사용액은 통장에서 산출)
      current_balance: creditLine ? 0 : num(form.current_balance),
      monthly_principal: creditLine ? 0 : num(form.monthly_principal),
      balance_date: form.balance_date || null,
      interest_rate: form.interest_rate === '' ? null : Number(form.interest_rate),
      monthly_interest: creditLine ? 0 : num(form.monthly_interest),
      payment_day: form.payment_day === '' ? null : Math.min(Math.max(parseInt(form.payment_day) || 1, 1), 31),
      start_date: form.start_date || null, maturity_date: form.maturity_date || null,
      term_type: form.term_type, status: form.status, memo: form.memo.trim() || null,
    }
    const isNew = editing === 'new'
    const res = await fetch(isNew ? '/api/loans' : `/api/loans/${(editing as Loan).id}`, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { showMsg(json.error ?? '저장 실패'); return }
    setEditing(null)
    showMsg(isNew ? '대출이 등록되었습니다.' : '수정되었습니다.')
    load()
  }

  const input = 'mt-1 w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900'
  const chip = (key: string, label: string, count?: number) => (
    <button key={key} onClick={() => setFilter(key)}
      className={`px-3 py-1 rounded-full text-sm whitespace-nowrap ${filter === key
        ? 'bg-slate-900 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
      {label}{count !== undefined ? ` ${count}` : ''}
    </button>
  )
  const th = 'py-2.5 px-3 font-medium whitespace-nowrap'
  const creditLineForm = form.product_type === 'credit_line'

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">대출 관리</h1>
          {tab === 'list' && (
            <p className="text-sm mt-1 text-gray-500">
              일반 대출은 약정 원금과 상환 스케줄로, 한도대출(마이너스 통장)은 약정한도와 사용액으로 관리합니다.
              한도대출의 사용액은 통장 잔액에서 자동으로 계산되며 별도 입력이 필요 없습니다.
            </p>
          )}
        </div>
        {tab === 'list' && (
          <button onClick={() => openEdit('new')}
            className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 whitespace-nowrap">
            + 대출 등록
          </button>
        )}
      </div>

      {/* 탭 */}
      <div className="flex items-center gap-1 mt-4 border-b border-gray-200">
        {([['list', '대출 현황'], ['report', '연간 리포트']] as const).map(([k, label]) => (
          <button key={k} onClick={() => goTab(k)}
            className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${tab === k
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {!migrationOk && (
        <div className="mt-3 px-4 py-3 bg-amber-50 border border-amber-300 text-amber-800 text-sm rounded-lg">
          마이그레이션 402(loans)가 아직 실행되지 않았습니다 — SQL 편집기에서 402_loans_master.sql을 실행해 주세요.
        </div>
      )}
      {migrationOk && !migration404 && (
        <div className="mt-3 px-4 py-3 bg-amber-50 border border-amber-300 text-amber-800 text-sm rounded-lg">
          마이그레이션 404(한도대출 분리)가 아직 실행되지 않았습니다 — 실행 전까지 마이너스 통장이 일반 대출로 표시됩니다.
        </div>
      )}

      {tab === 'list' && (<>
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
        <button onClick={() => setFilter('all')} className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-slate-400">
          <div className="text-xs text-gray-400">대출 잔액 (일반)</div>
          <div className="text-xl font-bold mt-1">{eok(kpi.balance)}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">원 대출 {eok(kpi.original)}</div>
        </button>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-400">월 원리금 (참고)</div>
          <div className="text-xl font-bold mt-1">{manwon(kpi.principal + kpi.interest)}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">원금 {manwon(kpi.principal)} · 이자 {manwon(kpi.interest)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-400">한도대출 약정한도</div>
          <div className="text-xl font-bold mt-1">{eok(kpi.limit)}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">마이너스 통장 {lines.length}건</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-400">한도 사용액</div>
          <div className={`text-xl font-bold mt-1 ${kpi.used > 0 ? 'text-rose-600' : ''}`}>{eok(kpi.used)}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            미사용 {eok(Math.max(kpi.limit - kpi.used, 0))}
            {kpi.lineInterest > 0 && ` · 예상 월이자 ${manwon(kpi.lineInterest)}`}
          </div>
        </div>
        <button onClick={() => setFilter('check')}
          className={`border rounded-xl p-4 text-left ${kpi.check > 0
            ? 'bg-amber-50 border-amber-300 hover:border-amber-400' : 'bg-white border-gray-200'}`}>
          <div className={`text-xs ${kpi.check > 0 ? 'text-amber-700' : 'text-gray-400'}`}>확인 필요</div>
          <div className={`text-xl font-bold mt-1 ${kpi.check > 0 ? 'text-amber-800' : ''}`}>{kpi.check}건</div>
          <div className={`text-[11px] mt-0.5 ${kpi.check > 0 ? 'text-amber-700' : 'text-gray-400'}`}>만기 경과·메모 확인</div>
        </button>
      </div>

      {/* 칩 필터 */}
      <div className="flex items-center gap-2 mt-4 flex-wrap">
        {chip('all', '전체', loans.length)}
        {banks.map(b => chip(`bank:${b}`, b, loans.filter(l => l.bank_name === b).length))}
        {chip('status:active', '상환 중', loans.filter(l => l.status === 'active').length)}
        {chip('status:unused', '미사용', loans.filter(l => l.status === 'unused').length)}
        {chip('status:closed', '종결', loans.filter(l => l.status === 'closed').length)}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : (
        <>
          {/* ── 일반 대출 ── */}
          <div className="flex items-baseline gap-2 mt-6 mb-2">
            <h2 className="text-sm font-semibold text-gray-700">일반 대출</h2>
            <span className="text-xs text-gray-400">약정 원금과 상환 스케줄로 관리</span>
          </div>
          {visibleTerms.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">표시할 대출이 없습니다.</div>
          ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                  <th className={th}>NO</th>
                  <th className={th}>대출명</th>
                  <th className={th}>은행</th>
                  <th className={th}>출금 계좌</th>
                  <th className={`${th} text-right`}>현 잔액</th>
                  <th className={`${th} text-right`}>이율</th>
                  <th className={`${th} text-right`}>월 원금</th>
                  <th className={`${th} text-right`}>월 이자(참고)</th>
                  <th className={`${th} text-center`}>상환일</th>
                  <th className={th}>만기</th>
                  <th className={`${th} text-center`}>구분</th>
                  <th className={`${th} text-center`}>상태</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody className="text-gray-700">
                {visibleTerms.map(l => (
                  <tr key={l.id} className={`border-b border-gray-100 ${l.status !== 'active' ? 'text-gray-400' : ''}`}>
                    <td className="py-2 px-3">{l.seq ?? '-'}</td>
                    <td className="py-2 px-3">
                      {l.title}
                      {(needsCheck(l) || isOverdue(l)) && (
                        <span className="ml-1 inline-block whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">확인 필요</span>
                      )}
                      {l.memo && <div className="text-[11px] text-amber-700 mt-0.5">{l.memo}</div>}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">{l.bank_name}</td>
                    <td className="py-2 px-3 text-gray-500 whitespace-nowrap">{acctLabel(l.bank_accounts)}</td>
                    <td className="py-2 px-3 text-right font-medium whitespace-nowrap">{won(l.current_balance)}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">{l.interest_rate != null ? `${l.interest_rate}%` : '-'}</td>
                    <td className={`py-2 px-3 text-right whitespace-nowrap ${l.monthly_principal ? '' : 'text-gray-400'}`}>
                      {l.monthly_principal ? won(l.monthly_principal) : '-'}
                    </td>
                    <td className={`py-2 px-3 text-right whitespace-nowrap ${l.monthly_interest ? '' : 'text-gray-400'}`}>
                      {l.monthly_interest ? won(l.monthly_interest) : '-'}
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">{l.payment_day ? `${l.payment_day}일` : '-'}</td>
                    <td className={`py-2 px-3 whitespace-nowrap ${isOverdue(l) ? 'text-red-600' : ''}`}>{l.maturity_date ?? '-'}</td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      <span className="inline-block whitespace-nowrap text-[11px] px-1.5 py-0.5 rounded bg-slate-100">{TERM_LABEL[l.term_type]}</span>
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      <span className={`inline-block whitespace-nowrap text-[11px] px-1.5 py-0.5 rounded ${l.status === 'active'
                        ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100'}`}>{STATUS_LABEL[l.status]}</span>
                    </td>
                    <td className="py-2 px-3">
                      <button onClick={() => openEdit(l)}
                        className="text-xs px-2 py-1 border border-gray-300 rounded-lg hover:bg-gray-50 whitespace-nowrap">수정</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-slate-50 font-medium">
                  <td className="py-2 px-3" colSpan={4}>합계 ({visibleTerms.length}건)</td>
                  <td className="py-2 px-3 text-right">{won(visibleTerms.reduce((s, l) => s + l.current_balance, 0))}</td>
                  <td className="py-2 px-3" />
                  <td className="py-2 px-3 text-right">{won(visibleTerms.reduce((s, l) => s + l.monthly_principal, 0))}</td>
                  <td className="py-2 px-3 text-right">{won(visibleTerms.reduce((s, l) => s + l.monthly_interest, 0))}</td>
                  <td className="py-2 px-3" colSpan={5} />
                </tr>
              </tfoot>
            </table>
          </div>
          )}

          {/* ── 한도대출 (마이너스 통장) ── */}
          <div className="flex items-baseline gap-2 mt-8 mb-2">
            <h2 className="text-sm font-semibold text-gray-700">한도대출 (마이너스 통장)</h2>
            <span className="text-xs text-gray-400">사용액·미사용 한도는 통장 잔액에서 자동 산출</span>
          </div>
          {visibleLines.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">
              표시할 한도대출이 없습니다.
            </div>
          ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                  <th className={th}>NO</th>
                  <th className={th}>대출명</th>
                  <th className={th}>은행</th>
                  <th className={th}>연결 계좌</th>
                  <th className={`${th} text-right`}>약정한도</th>
                  <th className={`${th} text-right`}>사용액</th>
                  <th className={th}>사용률</th>
                  <th className={`${th} text-right`}>미사용 한도</th>
                  <th className={`${th} text-right`}>이율</th>
                  <th className={`${th} text-right`}>월 이자(예상)</th>
                  <th className={`${th} text-center`}>이자 납부일</th>
                  <th className={th}>만기</th>
                  <th className={`${th} text-center`}>상태</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody className="text-gray-700">
                {visibleLines.map(l => {
                  const u = usage(l)
                  const rate = u.limit > 0 ? Math.min((u.used / u.limit) * 100, 100) : 0
                  return (
                    <tr key={l.id} className={`border-b border-gray-100 ${l.status === 'closed' ? 'text-gray-400' : ''}`}>
                      <td className="py-2 px-3">{l.seq ?? '-'}</td>
                      <td className="py-2 px-3">
                        {l.title}
                        {(needsCheck(l) || isOverdue(l)) && (
                          <span className="ml-1 inline-block whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">확인 필요</span>
                        )}
                        {!u.linked && (
                          <span className="ml-1 inline-block whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-300">계좌 미연결</span>
                        )}
                        {l.memo && <div className="text-[11px] text-amber-700 mt-0.5">{l.memo}</div>}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">{l.bank_name}</td>
                      <td className="py-2 px-3 text-gray-500 whitespace-nowrap">{acctLabel(l.bank_accounts)}</td>
                      <td className="py-2 px-3 text-right font-medium whitespace-nowrap">{won(u.limit)}</td>
                      <td className={`py-2 px-3 text-right whitespace-nowrap ${u.used > 0 ? 'text-rose-600 font-medium' : 'text-gray-400'}`}>
                        {u.used > 0 ? won(u.used) : '-'}
                      </td>
                      <td className="py-2 px-3 min-w-[90px]">
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden min-w-[40px]">
                            <div className={`h-full ${rate >= 80 ? 'bg-rose-500' : rate > 0 ? 'bg-slate-700' : ''}`}
                              style={{ width: `${rate}%` }} />
                          </div>
                          <span className="text-[11px] text-gray-500 whitespace-nowrap">{rate.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">{won(u.available)}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">{l.interest_rate != null ? `${l.interest_rate}%` : '-'}</td>
                      <td className={`py-2 px-3 text-right whitespace-nowrap ${u.used > 0 ? '' : 'text-gray-400'}`}
                        title={u.used > 0 && l.interest_rate != null
                          ? `일 이자 ${won(estDailyInterest(u.used, l.interest_rate))}원 x ${daysInThisMonth()}일`
                          : undefined}>
                        {u.used > 0 && l.interest_rate != null ? won(estMonthlyInterest(u.used, l.interest_rate)) : '-'}
                      </td>
                      <td className="py-2 px-3 text-center whitespace-nowrap">{l.payment_day ? `${l.payment_day}일` : '-'}</td>
                      <td className={`py-2 px-3 whitespace-nowrap ${isOverdue(l) ? 'text-red-600' : ''}`}>{l.maturity_date ?? '-'}</td>
                      <td className="py-2 px-3 text-center whitespace-nowrap">
                        <span className={`inline-block whitespace-nowrap text-[11px] px-1.5 py-0.5 rounded ${
                          u.used > 0 ? 'bg-rose-50 text-rose-700' : 'bg-gray-100'}`}>
                          {u.used > 0 ? '사용 중' : '미사용'}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <button onClick={() => openEdit(l)}
                          className="text-xs px-2 py-1 border border-gray-300 rounded-lg hover:bg-gray-50 whitespace-nowrap">수정</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-slate-50 font-medium">
                  <td className="py-2 px-3" colSpan={4}>합계 ({visibleLines.length}건)</td>
                  <td className="py-2 px-3 text-right">{won(visibleLines.reduce((s, l) => s + usage(l).limit, 0))}</td>
                  <td className="py-2 px-3 text-right">{won(visibleLines.reduce((s, l) => s + usage(l).used, 0))}</td>
                  <td className="py-2 px-3" />
                  <td className="py-2 px-3 text-right">{won(visibleLines.reduce((s, l) => s + usage(l).available, 0))}</td>
                  <td className="py-2 px-3" />
                  <td className="py-2 px-3 text-right">
                    {won(visibleLines.reduce((s, l) => s + estMonthlyInterest(usage(l).used, l.interest_rate), 0))}
                  </td>
                  <td className="py-2 px-3" colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
          )}
          <p className="text-xs text-gray-400 mt-2">
            한도대출 사용액은 마이너스 통장의 최신 잔액에서 계산합니다(자금현황과 같은 기준).
            사용액이 0으로만 보이면 해당 계좌가 통장 관리에서 마이너스통장으로 설정되어 있는지 확인해 주세요.
            <br />
            월 이자(예상) = 사용액 × 연이율 ÷ 365 × 당월 일수({daysInThisMonth()}일). 마이너스 통장은 일할 후취라
            사용액이 바뀌면 실제 이자도 달라집니다 — 확정 금액이 아니라 현재 사용액이 유지된다고 가정한 추정치입니다.
          </p>
        </>
      )}
      </>)}

      {tab === 'report' && <AnnualReport loans={reportLoans} />}

      {/* 편집 모달 */}
      {editing && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white border border-gray-300 rounded-2xl shadow-xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold">
                {editing === 'new' ? '대출 등록' : `대출 수정 — ${(editing as Loan).title} (${(editing as Loan).bank_name})`}
              </h2>
              <button onClick={() => setEditing(null)} className="text-gray-400 text-sm hover:text-gray-600">닫기</button>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
              <label className="block col-span-2"><span className="text-xs text-gray-500">대출 종류</span>
                <select value={form.product_type} onChange={e => setForm(f => ({ ...f, product_type: e.target.value }))} className={input}>
                  <option value="term">일반 대출 (약정 원금·상환 스케줄)</option>
                  <option value="credit_line">한도대출 / 마이너스 통장 (한도·사용액)</option>
                </select></label>
              <label className="block"><span className="text-xs text-gray-500">대출명</span>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={input} /></label>
              <label className="block"><span className="text-xs text-gray-500">은행</span>
                <input value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} className={input} /></label>
              <label className="block col-span-2">
                <span className="text-xs text-gray-500">{creditLineForm ? '연결 계좌 (사용액 산출 기준)' : '출금 계좌'}</span>
                <select value={form.bank_account_id} onChange={e => setForm(f => ({ ...f, bank_account_id: e.target.value }))} className={input}>
                  <option value="">(미연결)</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>{b.bank_name} {b.account_number ?? ''}</option>
                  ))}
                </select></label>

              {creditLineForm ? (
                <>
                  <label className="block"><span className="text-xs text-gray-500">약정한도 (원)</span>
                    <input value={form.credit_limit} onChange={e => setForm(f => ({ ...f, credit_limit: e.target.value }))}
                      className={`${input} text-right`} inputMode="numeric" /></label>
                  <label className="block"><span className="text-xs text-gray-500">이율 (%)</span>
                    <input value={form.interest_rate} onChange={e => setForm(f => ({ ...f, interest_rate: e.target.value }))}
                      className={`${input} text-right`} inputMode="decimal" /></label>
                  <label className="block"><span className="text-xs text-gray-500">이자 납부일 (1~31, 말일=31)</span>
                    <input value={form.payment_day} onChange={e => setForm(f => ({ ...f, payment_day: e.target.value }))}
                      className={`${input} text-right`} inputMode="numeric" /></label>
                  <p className="col-span-2 text-[11px] text-gray-500 bg-slate-50 border border-gray-200 rounded-lg px-2.5 py-2">
                    한도대출은 잔액·월 원금·월 이자를 입력하지 않습니다. 사용액과 미사용 한도는 연결 계좌의 통장 잔액에서
                    자동 산출되고, 월 이자는 사용액 × 연이율 ÷ 365 × 당월 일수로 계산해 표시합니다(일할 후취).
                  </p>
                </>
              ) : (
                <>
                  <label className="block"><span className="text-xs text-gray-500">현 잔액 (원)</span>
                    <input value={form.current_balance} onChange={e => setForm(f => ({ ...f, current_balance: e.target.value }))}
                      className={`${input} text-right`} inputMode="numeric" /></label>
                  <label className="block"><span className="text-xs text-gray-500">잔액 기준일</span>
                    <input type="date" value={form.balance_date} onChange={e => setForm(f => ({ ...f, balance_date: e.target.value }))} className={input} /></label>
                  <label className="block"><span className="text-xs text-gray-500">이율 (%)</span>
                    <input value={form.interest_rate} onChange={e => setForm(f => ({ ...f, interest_rate: e.target.value }))}
                      className={`${input} text-right`} inputMode="decimal" /></label>
                  <label className="block"><span className="text-xs text-gray-500">상환일 (1~31, 말일=31)</span>
                    <input value={form.payment_day} onChange={e => setForm(f => ({ ...f, payment_day: e.target.value }))}
                      className={`${input} text-right`} inputMode="numeric" /></label>
                  <label className="block"><span className="text-xs text-gray-500">월 원금 상환액 (원, 0=이자만)</span>
                    <input value={form.monthly_principal} onChange={e => setForm(f => ({ ...f, monthly_principal: e.target.value }))}
                      className={`${input} text-right`} inputMode="numeric" /></label>
                  <label className="block"><span className="text-xs text-gray-500">월 이자 · 참고 (원)</span>
                    <input value={form.monthly_interest} onChange={e => setForm(f => ({ ...f, monthly_interest: e.target.value }))}
                      className={`${input} text-right`} inputMode="numeric" /></label>
                </>
              )}

              <label className="block"><span className="text-xs text-gray-500">신규일</span>
                <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className={input} /></label>
              <label className="block"><span className="text-xs text-gray-500">만기일</span>
                <input type="date" value={form.maturity_date} onChange={e => setForm(f => ({ ...f, maturity_date: e.target.value }))} className={input} /></label>
              {!creditLineForm && (
                <label className="block"><span className="text-xs text-gray-500">구분</span>
                  <select value={form.term_type} onChange={e => setForm(f => ({ ...f, term_type: e.target.value }))} className={input}>
                    <option value="long">장기차입금</option>
                    <option value="short">단기차입금</option>
                  </select></label>
              )}
              <label className="block"><span className="text-xs text-gray-500">상태</span>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={input}>
                  <option value="active">상환 중</option>
                  <option value="unused">미사용</option>
                  <option value="closed">종결</option>
                </select></label>
              <label className="block col-span-2"><span className="text-xs text-gray-500">메모</span>
                <textarea rows={2} value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} className={input} /></label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditing(null)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">취소</button>
              <button onClick={save} disabled={saving}
                className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
