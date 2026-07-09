'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type CycleStatus = '완료' | '계산서 대기' | '지급 대기' | '금액 차이' | '과다 지급' | '경비성'
type Severity = '정상 대기' | '주의' | '확인 필요'

interface ExceptionRow {
  vendor_id: string
  vendor_name: string
  month: string
  status: CycleStatus
  severity: Severity
  erp_amount: number
  invoice_supply: number
  paid_amount: number
  gap: number
  detail: string
  cause: string | null
}
interface Summary { 완료: number; '계산서 대기': number; '지급 대기': number; '금액 차이': number; '과다 지급': number; 경비성: number }

const STATUS_BADGE: Record<string, string> = {
  '계산서 대기': 'bg-amber-100 text-amber-800',
  '지급 대기': 'bg-blue-100 text-blue-800',
  '금액 차이': 'bg-rose-100 text-rose-800',
  '과다 지급': 'bg-purple-100 text-purple-800',
}
const SEV_BADGE: Record<Severity, string> = {
  '확인 필요': 'bg-red-600 text-white',
  '주의': 'bg-orange-400 text-white',
  '정상 대기': 'bg-gray-200 text-gray-600',
}

interface CandInvoice { id: string; issue_date: string; item_name: string | null; total_amount: number; remaining: number }
interface CandTx { id: string; tx_date: string; description: string | null; amount_out: number; remaining: number }
interface CandGroup {
  type: string; label: string
  invoices: CandInvoice[]; txs: CandTx[]; amount: number
  links: { invoiceId: string; transactionId: string; amount: number }[]
}

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`
const monthStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

// ── 지급 후보 모달 (3단계 — 후보는 시스템, 확정은 사용자) ─────────────
function CandidateModal({ vendorId, vendorName, onClose, onApplied }: {
  vendorId: string; vendorName: string; onClose: () => void; onApplied: () => void
}) {
  const [groups, setGroups] = useState<CandGroup[] | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [summary, setSummary] = useState<{ unpaid_invoices: number; available_txs: number; coverable_amount: number } | null>(null)

  useEffect(() => {
    fetch(`/api/purchase-cycle/payment-candidates?vendorId=${vendorId}`, { cache: 'no-store' })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) { setError(j.error ?? '후보 조회 실패'); return }
        setGroups(j.groups ?? [])
        setSummary(j.summary ?? null)
        setChecked(new Set((j.groups ?? []).map((_: unknown, i: number) => i)))  // 기본 전체 선택
      })
      .catch(() => setError('네트워크 오류'))
  }, [vendorId])

  const apply = async () => {
    if (!groups) return
    const links = groups.filter((_, i) => checked.has(i)).flatMap(g => g.links)
    if (!links.length) return
    if (!window.confirm(`${vendorName}: 선택한 ${checked.size}개 그룹(연결 ${links.length}건)을 확정합니다.`)) return
    setApplying(true)
    const res = await fetch('/api/purchase-cycle/apply-payments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ links }),
    })
    const json = await res.json()
    setApplying(false)
    if (!res.ok) { setError(json.error ?? '연결 실패'); return }
    onApplied()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900">{vendorName} — 지급 연결 후보</h3>
        <p className="text-xs text-gray-500 mt-1 mb-4">
          금액이 정확히 맞는 조합만 제시합니다. 확인 후 확정하세요 (연결은 언제든 해제 가능).
          {summary && ` · 미결제 계산서 ${summary.unpaid_invoices}건 · 미연결 출금 ${summary.available_txs}건`}
        </p>
        {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}
        {!groups ? (
          <p className="text-gray-400 text-sm py-8 text-center">후보 계산 중...</p>
        ) : groups.length === 0 ? (
          <p className="text-gray-500 text-sm py-8 text-center">
            금액이 맞는 후보가 없습니다.<br />
            <span className="text-xs text-gray-400">통장 출금에 이 거래처가 연결(태깅)되어 있어야 후보에 잡힙니다.
            거래내역 화면에서 해당 출금에 거래처를 지정한 뒤 다시 시도해보세요.</span>
          </p>
        ) : (
          <>
            <div className="space-y-3">
              {groups.map((g, i) => (
                <label key={i} className={`block border rounded-lg p-3 cursor-pointer ${checked.has(i) ? 'border-slate-800 bg-slate-50' : 'border-gray-200'}`}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={checked.has(i)}
                      onChange={e => setChecked(prev => { const n = new Set(prev); if (e.target.checked) n.add(i); else n.delete(i); return n })} />
                    <span className="text-sm font-medium text-gray-900">{g.label}</span>
                    <span className="ml-auto text-sm font-semibold tabular-nums">{won(g.amount)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-2 text-xs">
                    <div>
                      <p className="text-gray-400 mb-1">계산서</p>
                      {g.invoices.map(inv => (
                        <p key={inv.id} className="text-gray-700">{inv.issue_date.slice(0, 10)} · {(inv.item_name ?? '').slice(0, 14) || '-'} · {won(inv.remaining)}</p>
                      ))}
                    </div>
                    <div>
                      <p className="text-gray-400 mb-1">통장 출금</p>
                      {g.txs.map(tx => (
                        <p key={tx.id} className="text-gray-700">{tx.tx_date.slice(0, 10)} · {(tx.description ?? '').slice(0, 14) || '-'} · {won(tx.remaining)}</p>
                      ))}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">닫기</button>
              <button onClick={apply} disabled={applying || checked.size === 0}
                className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
                {applying ? '연결 중...' : `선택 ${checked.size}개 그룹 연결 확정`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// 매입 사이클 — 예외 관리 (설계 v3 §4: 정상보다 예외를 먼저)
// 상태는 저장되지 않고 조회 시 계산된다. 이 화면이 매입 담당자의 To-Do 리스트.
export default function PurchaseCyclePage() {
  const now = new Date()
  const [monthFrom, setMonthFrom] = useState(() => monthStr(new Date(now.getFullYear() - 1, now.getMonth(), 1)))
  const [monthTo, setMonthTo] = useState(() => monthStr(now))
  const [rows, setRows] = useState<ExceptionRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<string>('')
  const [minSeverity, setMinSeverity] = useState<'전체' | '주의 이상' | '확인 필요만'>('주의 이상')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<{ vendorId: string; vendorName: string } | null>(null)
  const [autoMatching, setAutoMatching] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000) }

  // 1:1 정확 일치 자동매칭 (기존 세금계산서 자동매칭 재사용 — 확실한 것만 조용히 연결)
  const runAutoMatch = async () => {
    if (!window.confirm('매입 세금계산서 전체에 대해 금액·거래처가 정확히 일치하는 통장 출금을 자동 연결합니다.')) return
    setAutoMatching(true)
    const res = await fetch('/api/tax-invoices/auto-match', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'purchase' }),
    })
    const json = await res.json()
    setAutoMatching(false)
    if (!res.ok) { showMsg(`자동매칭 실패: ${json.error ?? '오류'}`); return }
    showMsg(`1:1 자동매칭 완료: ${json.matched}건 연결 (검사 ${json.checked}건)`)
    load()
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/purchase-cycle?from=${monthFrom}&to=${monthTo}`, { cache: 'no-store' })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? '조회 실패'); setRows([]); setSummary(null) }
    else { setRows(json.exceptions ?? []); setSummary(json.summary ?? null) }
    setLoading(false)
  }, [monthFrom, monthTo])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => rows.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false
    if (minSeverity === '주의 이상' && r.severity === '정상 대기') return false
    if (minSeverity === '확인 필요만' && r.severity !== '확인 필요') return false
    if (search.trim() && !r.vendor_name.includes(search.trim())) return false
    return true
  }), [rows, statusFilter, minSeverity, search])

  const chip = (label: string, count: number, active: boolean, onClick: () => void, cls: string) => (
    <button key={label} onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${active ? 'ring-2 ring-slate-900 ' : ''}${cls}`}>
      {label} <b>{count.toLocaleString()}</b>
    </button>
  )

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">매입 사이클 — 예외 관리</h1>
          <p className="text-sm mt-1 text-gray-500">
            ERP 주문 → 세금계산서 → 지급 흐름에서 확인이 필요한 건을 먼저 보여줍니다.
            상태는 저장되지 않고 조회 시점에 계산됩니다 (거래처 × 월 단위).
          </p>
        </div>
        <button onClick={runAutoMatch} disabled={autoMatching}
          className="px-3 py-1.5 border border-blue-400 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-50 disabled:opacity-50 whitespace-nowrap">
          {autoMatching ? '매칭 중...' : '1:1 정확 매칭 일괄 실행'}
        </button>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="mb-3 mt-2 px-4 py-2.5 bg-red-600 text-white text-sm rounded-lg">{error}</div>}

      {/* 기간 + 필터 */}
      <div className="flex items-center gap-2 my-3 flex-wrap">
        <input type="month" value={monthFrom} onChange={e => setMonthFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="month" value={monthTo} onChange={e => setMonthTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <select value={minSeverity} onChange={e => setMinSeverity(e.target.value as typeof minSeverity)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
          <option>주의 이상</option>
          <option>확인 필요만</option>
          <option>전체</option>
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="거래처 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-44" />
      </div>

      {/* 유형 칩 (클릭 = 필터) */}
      {summary && (
        <div className="flex flex-wrap gap-2 mb-4">
          {chip('계산서 대기', summary['계산서 대기'], statusFilter === '계산서 대기',
            () => setStatusFilter(f => f === '계산서 대기' ? '' : '계산서 대기'), 'bg-amber-50 border-amber-200 text-amber-800')}
          {chip('지급 대기', summary['지급 대기'], statusFilter === '지급 대기',
            () => setStatusFilter(f => f === '지급 대기' ? '' : '지급 대기'), 'bg-blue-50 border-blue-200 text-blue-800')}
          {chip('금액 차이', summary['금액 차이'], statusFilter === '금액 차이',
            () => setStatusFilter(f => f === '금액 차이' ? '' : '금액 차이'), 'bg-rose-50 border-rose-200 text-rose-800')}
          {chip('과다 지급', summary['과다 지급'], statusFilter === '과다 지급',
            () => setStatusFilter(f => f === '과다 지급' ? '' : '과다 지급'), 'bg-purple-50 border-purple-200 text-purple-800')}
          {/* 완료·경비성은 severity가 '정상 대기'라 기본 필터(주의 이상)에서 숨겨지므로
              클릭 시 심각도 필터를 '전체'로 함께 전환한다 */}
          {chip('완료', summary['완료'], statusFilter === '완료',
            () => { setStatusFilter(f => f === '완료' ? '' : '완료'); setMinSeverity('전체') }, 'bg-green-50 border-green-200 text-green-700')}
          {chip('경비성', summary['경비성'], statusFilter === '경비성',
            () => { setStatusFilter(f => f === '경비성' ? '' : '경비성'); setMinSeverity('전체') }, 'bg-emerald-50 border-emerald-200 text-emerald-700')}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm py-10 text-center">상태 계산 중...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border border-green-200 bg-green-50 rounded-xl">
          <p className="text-green-700 font-medium">표시할 예외가 없습니다</p>
          <p className="text-xs text-green-600 mt-1">필터를 &lsquo;전체&rsquo;로 바꾸면 정상 대기 건까지 볼 수 있습니다.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left w-24">유형</th>
                <th className="px-3 py-2 text-left w-20">심각도</th>
                <th className="px-3 py-2 text-left">거래처</th>
                <th className="px-3 py-2 text-left w-20">월</th>
                <th className="px-3 py-2 text-left">내용 (무엇을 · 얼마나)</th>
                <th className="px-3 py-2 text-left">추정 원인</th>
                <th className="px-3 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${STATUS_BADGE[r.status] ?? 'bg-gray-100'}`}>{r.status}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${SEV_BADGE[r.severity]}`}>{r.severity}</span>
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-900">{r.vendor_name}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.month}</td>
                  <td className="px-3 py-2 text-gray-700 text-xs">{r.detail}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{r.cause ?? ''}</td>
                  <td className="px-3 py-2 text-right">
                    {(r.status === '지급 대기' || r.status === '과다 지급') && (
                      <button onClick={() => setModal({ vendorId: r.vendor_id, vendorName: r.vendor_name })}
                        className="px-2 py-1 bg-slate-900 text-white rounded text-xs font-medium hover:bg-slate-700 whitespace-nowrap">
                        지급 후보
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3">
        판정 기준(조정 가능): 금액차이 허용 ±10% · 지급완료 95% · 과다지급 105% ·
        경과 0~1개월 정상대기 / 2개월 주의 / 3개월↑ 확인필요. 지급은 계산서 결제연결 + 미지급금(2001) 확정 출금 기준.
      </p>

      {modal && (
        <CandidateModal
          vendorId={modal.vendorId} vendorName={modal.vendorName}
          onClose={() => setModal(null)}
          onApplied={() => { setModal(null); showMsg('지급 연결이 확정되었습니다.'); load() }}
        />
      )}
    </div>
  )
}
