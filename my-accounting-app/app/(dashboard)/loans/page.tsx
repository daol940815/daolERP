'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

const won = (n: number | null | undefined) => (n ?? 0).toLocaleString('ko-KR')
const eok = (n: number) => `${(n / 1e8).toFixed(2)}억`
const manwon = (n: number) => `${Math.round(n / 1e4).toLocaleString('ko-KR')}만`

interface BankAccount { id: string; bank_name: string; account_number: string | null }
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
  memo: string | null
}

const STATUS_LABEL: Record<Loan['status'], string> = { active: '상환 중', unused: '미사용', closed: '종결' }
const TERM_LABEL: Record<Loan['term_type'], string> = { short: '단기', long: '장기' }

const acctLabel = (b: { bank_name: string; account_number: string | null } | null) =>
  b ? `${b.bank_name.replace('은행', '')} …${(b.account_number ?? '').slice(-4)}` : '-'

const today = () => new Date().toISOString().slice(0, 10)

type EditForm = {
  title: string; bank_name: string; bank_account_id: string
  current_balance: string; balance_date: string; interest_rate: string
  monthly_principal: string; monthly_interest: string; payment_day: string
  start_date: string; maturity_date: string; term_type: string; status: string; memo: string
}

const emptyForm: EditForm = {
  title: '', bank_name: '', bank_account_id: '', current_balance: '', balance_date: today(),
  interest_rate: '', monthly_principal: '0', monthly_interest: '0', payment_day: '',
  start_date: '', maturity_date: '', term_type: 'long', status: 'active', memo: '',
}

export default function LoansPage() {
  const [loans, setLoans] = useState<Loan[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [migrationOk, setMigrationOk] = useState(true)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all') // all | check | bank:이름 | term:short/long | status:...
  const [msg, setMsg] = useState<string | null>(null)
  const [editing, setEditing] = useState<Loan | 'new' | null>(null)
  const [form, setForm] = useState<EditForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/loans')
    const json = await res.json()
    if (res.ok) {
      setLoans(json.loans ?? [])
      setBankAccounts(json.bankAccounts ?? [])
      setMigrationOk(json.migration402 !== false)
    } else showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const needsCheck = (l: Loan) => !!l.memo && l.memo.includes('확인 필요')
  const isOverdue = (l: Loan) => !!l.maturity_date && l.maturity_date < today() && l.status === 'active'

  const visible = useMemo(() => loans.filter(l => {
    if (filter === 'all') return true
    if (filter === 'check') return needsCheck(l) || isOverdue(l)
    const [kind, v] = filter.split(':')
    if (kind === 'bank') return l.bank_name === v
    if (kind === 'term') return l.term_type === v
    if (kind === 'status') return l.status === v
    return true
  }), [loans, filter])

  const active = loans.filter(l => l.status === 'active')
  const kpi = {
    balance: active.reduce((s, l) => s + l.current_balance, 0),
    original: loans.filter(l => l.status !== 'closed').reduce((s, l) => s + l.original_amount, 0),
    principal: active.reduce((s, l) => s + l.monthly_principal, 0),
    interest: active.reduce((s, l) => s + l.monthly_interest, 0),
    check: loans.filter(l => needsCheck(l) || isOverdue(l)).length,
  }
  const banks = Array.from(new Set(loans.map(l => l.bank_name)))

  const openEdit = (l: Loan | 'new') => {
    setEditing(l)
    if (l === 'new') { setForm(emptyForm); return }
    setForm({
      title: l.title, bank_name: l.bank_name, bank_account_id: l.bank_account_id ?? '',
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
    const body = {
      title: form.title.trim(), bank_name: form.bank_name.trim(),
      bank_account_id: form.bank_account_id || null,
      current_balance: num(form.current_balance),
      balance_date: form.balance_date || null,
      interest_rate: form.interest_rate === '' ? null : Number(form.interest_rate),
      monthly_principal: num(form.monthly_principal),
      monthly_interest: num(form.monthly_interest),
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
      className={`px-3 py-1 rounded-full text-sm ${filter === key
        ? 'bg-slate-900 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
      {label}{count !== undefined ? ` ${count}` : ''}
    </button>
  )

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">대출 관리</h1>
          <p className="text-sm mt-1 text-gray-500">
            대출 마스터입니다. 잔액·금리·만기 등은 수정 버튼으로 직접 편집합니다.
            원리금 거래 자동 분리는 대출 정보 확정 후 열립니다.
          </p>
        </div>
        <button onClick={() => openEdit('new')}
          className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700">
          + 대출 등록
        </button>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {!migrationOk && (
        <div className="mt-3 px-4 py-3 bg-amber-50 border border-amber-300 text-amber-800 text-sm rounded-lg">
          마이그레이션 402(loans)가 아직 실행되지 않았습니다 — SQL 편집기에서 402_loans_master.sql을 실행해 주세요.
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <button onClick={() => setFilter('all')} className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-slate-400">
          <div className="text-xs text-gray-400">대출 잔액 합계</div>
          <div className="text-xl font-bold mt-1">{eok(kpi.balance)}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">원 대출 {eok(kpi.original)}</div>
        </button>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-400">월 원금 상환</div>
          <div className="text-xl font-bold mt-1">{manwon(kpi.principal)}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">고정 상환 {active.filter(l => l.monthly_principal > 0).length}건</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-400">월 이자 (참고)</div>
          <div className="text-xl font-bold mt-1">{manwon(kpi.interest)}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">변동금리 — 매월 변동</div>
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
        {chip('term:long', '장기', loans.filter(l => l.term_type === 'long').length)}
        {chip('term:short', '단기', loans.filter(l => l.term_type === 'short').length)}
        {chip('status:active', '상환 중', loans.filter(l => l.status === 'active').length)}
        {chip('status:unused', '미사용', loans.filter(l => l.status === 'unused').length)}
        {chip('status:closed', '종결', loans.filter(l => l.status === 'closed').length)}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">표시할 대출이 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium">NO</th>
                <th className="py-2.5 px-3 font-medium">대출명</th>
                <th className="py-2.5 px-3 font-medium">은행</th>
                <th className="py-2.5 px-3 font-medium">출금 계좌</th>
                <th className="py-2.5 px-3 font-medium text-right">현 잔액</th>
                <th className="py-2.5 px-3 font-medium text-right">이율</th>
                <th className="py-2.5 px-3 font-medium text-right">월 원금</th>
                <th className="py-2.5 px-3 font-medium text-right">월 이자(참고)</th>
                <th className="py-2.5 px-3 font-medium text-center">상환일</th>
                <th className="py-2.5 px-3 font-medium">만기</th>
                <th className="py-2.5 px-3 font-medium text-center whitespace-nowrap">구분</th>
                <th className="py-2.5 px-3 font-medium text-center whitespace-nowrap">상태</th>
                <th className="py-2.5 px-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="text-gray-700">
              {visible.map(l => (
                <tr key={l.id} className={`border-b border-gray-100 ${l.status !== 'active' ? 'text-gray-400' : ''}`}>
                  <td className="py-2 px-3">{l.seq ?? '-'}</td>
                  <td className="py-2 px-3">
                    {l.title}
                    {(needsCheck(l) || isOverdue(l)) && (
                      <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 whitespace-nowrap">확인 필요</span>
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
                    <span className={`text-[11px] px-1.5 py-0.5 rounded ${l.status === 'active'
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
                <td className="py-2 px-3" colSpan={4}>합계 ({visible.length}건)</td>
                <td className="py-2 px-3 text-right">{won(visible.reduce((s, l) => s + l.current_balance, 0))}</td>
                <td className="py-2 px-3" />
                <td className="py-2 px-3 text-right">{won(visible.reduce((s, l) => s + l.monthly_principal, 0))}</td>
                <td className="py-2 px-3 text-right">{won(visible.reduce((s, l) => s + l.monthly_interest, 0))}</td>
                <td className="py-2 px-3" colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

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
              <label className="block"><span className="text-xs text-gray-500">대출명</span>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={input} /></label>
              <label className="block"><span className="text-xs text-gray-500">은행</span>
                <input value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} className={input} /></label>
              <label className="block col-span-2"><span className="text-xs text-gray-500">출금 계좌</span>
                <select value={form.bank_account_id} onChange={e => setForm(f => ({ ...f, bank_account_id: e.target.value }))} className={input}>
                  <option value="">(미연결)</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>{b.bank_name} {b.account_number ?? ''}</option>
                  ))}
                </select></label>
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
              <label className="block"><span className="text-xs text-gray-500">신규일</span>
                <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className={input} /></label>
              <label className="block"><span className="text-xs text-gray-500">만기일</span>
                <input type="date" value={form.maturity_date} onChange={e => setForm(f => ({ ...f, maturity_date: e.target.value }))} className={input} /></label>
              <label className="block"><span className="text-xs text-gray-500">구분</span>
                <select value={form.term_type} onChange={e => setForm(f => ({ ...f, term_type: e.target.value }))} className={input}>
                  <option value="long">장기차입금</option>
                  <option value="short">단기차입금</option>
                </select></label>
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
