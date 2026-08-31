'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getPeriodRange, DEFAULT_VIEW_FROM } from '@/lib/period-presets'

// 매입처 관리 — 목록(A) 공용 컴포넌트
// 회계·경영 모드(/purchase-hub)와 주문 관리 모드(/orders/purchase-hub) 양쪽에서 쓴다.
//   basePath     상세 화면 링크의 기준 경로 (모드마다 다르다)
//   canDrilldown 회계·경영 모드 화면(별칭 관리 등)으로 나가는 링크 노출 여부.
//                admin이 아니면 그 화면들이 접근 불가라 링크를 감춘다.

interface Row {
  vendor_id: string
  vendor_name: string
  biz_number: string | null
  email: string | null
  purchase_kind: 'partner' | 'retail' | 'expense'
  alias_names: string[]
  alias_count: number
  staff_primary: string | null
  staff_extra: number
  contact_rep: string | null
  contact_extra: number
  invoice_count: number
  invoice_total: number
  erp_amount: number
  paid_amount: number
  outstanding: number
  over90: number
  opening_remain: number
  last_purchase_date: string | null
  status: string
}
interface Summary {
  active_vendors: number
  invoice_total: number
  paid_total: number
  outstanding_total: number
  over90_total: number
  pay_ratio: number
  unlinked_items: number
  unlinked_aliases: number
}

const won = (n: number) => n.toLocaleString('ko-KR')
const eok = (n: number) => Math.abs(n) >= 100000000 ? `${(n / 100000000).toFixed(2)}억` : Math.abs(n) >= 10000 ? `${Math.round(n / 10000).toLocaleString()}만` : won(n)

const STATUS_META: Record<string, { label: string; cls: string }> = {
  normal:   { label: '정상',            cls: 'bg-green-100 text-green-700' },
  unpaid:   { label: '미지급',          cls: 'bg-amber-100 text-amber-700' },
  over90:   { label: '미지급 90일 초과', cls: 'bg-red-100 text-red-700' },
  overpaid: { label: '과다지급',        cls: 'bg-violet-100 text-violet-700' },
  dormant:  { label: '휴면 전환',       cls: 'bg-gray-100 text-gray-500' },
  retail:   { label: '별도 구매처',      cls: 'bg-sky-100 text-sky-700' },
}

// ── 신규 매입처 등록 모달 ───────────────────────────────────────
// 매출처 등록과 같은 모양: 업체명(필수) + 지점명 + 담당자 정보. 나머지는 접어둔다.
// 이름이 완전히 같으면 서버가 조용히 기존 거래처를 재사용하고,
// 비슷하기만 하면 후보를 돌려준다 — 그때만 사용자가 확인한다.
function NewVendorModal({ onClose, onCreated, showKind }: {
  onClose: () => void
  onCreated: (id: string, reused: boolean) => void
  showKind: boolean
}) {
  const [form, setForm] = useState({
    group_name: '', branch_name: '',
    contact_name: '', contact_phone: '', contact_title: '',
    biz_number: '', email: '', purchase_kind: 'partner',
  })
  const [more, setMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dups, setDups] = useState<{ id: string; name: string; biz_number: string | null; type: string }[] | null>(null)

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (force = false) => {
    if (!form.group_name.trim()) { setError('업체명을 입력하세요.'); return }
    setSaving(true); setError(null)
    const res = await fetch('/api/purchase-hub', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, force }),
    })
    const json = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { setError(json.error ?? '등록 실패'); return }
    if (json.needs_confirm) { setDups(json.candidates); return }
    onCreated(json.vendor.id, !!json.reused)
  }

  const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm'
  const label = 'block text-xs font-medium text-gray-700 mb-1'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-6 w-[26rem] max-h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900 mb-1">신규 매입처 등록</h3>
        <p className="text-xs text-gray-400 mb-4">업체명만 있으면 등록됩니다. 등록 즉시 사용할 수 있습니다.</p>
        {error && <p className="text-red-600 text-xs mb-3">{error}</p>}

        <div className="space-y-3">
          <div>
            <label className={label}>업체명 <span className="text-red-500">*</span></label>
            <input autoFocus value={form.group_name} onChange={set('group_name')}
              placeholder="예: 제주 담은 귤" className={field} />
          </div>
          <div>
            <label className={label}>지점명 <span className="text-gray-400">(선택)</span></label>
            <input value={form.branch_name} onChange={set('branch_name')}
              placeholder="예: 인천점 — 지점이 없으면 비워두세요" className={field} />
            {form.group_name.trim() && form.branch_name.trim() && (
              <p className="text-[11px] text-gray-400 mt-1">
                거래처명: {form.group_name.trim()} {form.branch_name.trim()}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={label}>담당자명 <span className="text-gray-400">(선택)</span></label>
              <input value={form.contact_name} onChange={set('contact_name')} placeholder="예: 김담당" className={field} />
            </div>
            <div>
              <label className={label}>직함 <span className="text-gray-400">(선택)</span></label>
              <input value={form.contact_title} onChange={set('contact_title')} placeholder="예: 과장" className={field} />
            </div>
          </div>
          <div>
            <label className={label}>담당자 연락처 <span className="text-gray-400">(선택)</span></label>
            <input value={form.contact_phone} onChange={set('contact_phone')} placeholder="예: 010-0000-0000" className={field} />
          </div>

          <button onClick={() => setMore(v => !v)} className="text-xs text-gray-500 hover:text-gray-700 underline">
            {more ? '추가 정보 접기' : '사업자번호 · 발주 이메일 입력'}
          </button>
          {more && (
            <div className="space-y-3 pt-1">
              <div>
                <label className={label}>사업자번호</label>
                <input value={form.biz_number} onChange={set('biz_number')} placeholder="숫자 10자리" className={field} />
              </div>
              <div>
                <label className={label}>발주 이메일</label>
                <input value={form.email} onChange={set('email')} placeholder="example@company.com" className={field} />
              </div>
              {showKind && (
                <div>
                  <label className={label}>구분</label>
                  <select value={form.purchase_kind} onChange={set('purchase_kind')} className={`${field} bg-white`}>
                    <option value="partner">거래 매입처 (발주·미지급 관리)</option>
                    <option value="retail">별도 구매처 (사 온 곳, 즉시 결제)</option>
                    <option value="expense">경비성 (택배·전기·리스 등)</option>
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        {dups && (
          <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs">
            <div className="font-semibold text-amber-800 mb-1">이름이 비슷한 거래처가 있습니다 — 확인해주세요.</div>
            {dups.map(d => (
              <div key={d.id} className="py-0.5 text-gray-700">
                {d.name} <span className="text-gray-400">
                  {d.biz_number ?? '사업자번호 없음'} · {d.type === 'customer' ? '매출처' : d.type === 'both' ? '매출·매입' : '매입처'}
                </span>
              </div>
            ))}
            <div className="mt-1.5 text-amber-800">같은 곳이면 창을 닫고 기존 거래처를 쓰세요.</div>
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">취소</button>
          <button onClick={() => submit(!!dups)} disabled={saving}
            className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
            {saving ? '등록 중...' : dups ? '그래도 새로 등록' : '등록'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PurchaseHubList({ basePath, canDrilldown }: {
  basePath: string
  canDrilldown: boolean
}) {
  const router = useRouter()
  const [from, setFrom] = useState(DEFAULT_VIEW_FROM)
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [preset, setPreset] = useState<string>('당년')
  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [staffFilter, setStaffFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [erpOnly, setErpOnly] = useState(false)
  const [outstandingOnly, setOutstandingOnly] = useState(false)
  // 별도 구매처·경비성(602) — 발주·정산 관리 대상이 아니라 목록에서 걷어낼 수 있게 한다
  const [hideOnline, setHideOnline] = useState(false)
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/purchase-hub?from=${f}&to=${t}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '조회 실패')
      setRows(json.rows); setSummary(json.summary)
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(from, to) }, [load, from, to])

  const applyPreset = (p: string) => {
    setPreset(p)
    if (p === '전체 기간') { setFrom('2024-01-01'); setTo(new Date().toISOString().slice(0, 10)); return }
    const r = getPeriodRange(p)
    setFrom(r.from); setTo(r.to)
  }

  const staffNames = useMemo(() => {
    const s = new Set<string>()
    rows.forEach(r => { if (r.staff_primary) s.add(r.staff_primary) })
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ko'))
  }, [rows])

  // 검색: 매입처명 + ERP 별칭 표기 + 사업자번호(숫자 3자리 이상), 공백·대소문자 무시
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
  const visible = useMemo(() => rows.filter(r => {
    if (search) {
      const q = norm(search)
      const digits = search.replace(/\D/g, '')
      const hit = norm(r.vendor_name).includes(q)
        || r.alias_names.some(a => norm(a).includes(q))
        || (digits.length >= 3 && (r.biz_number ?? '').replace(/\D/g, '').includes(digits))
      if (!hit) return false
    }
    if (staffFilter && r.staff_primary !== staffFilter) return false
    if (statusFilter && r.status !== statusFilter) return false
    if (erpOnly && r.erp_amount <= 0) return false
    if (outstandingOnly && r.outstanding <= 0) return false
    if (hideOnline && r.purchase_kind !== 'partner') return false
    return true
  }), [rows, search, staffFilter, statusFilter, erpOnly, outstandingOnly, hideOnline])

  const filterActive = !!(search || staffFilter || statusFilter || erpOnly || outstandingOnly || hideOnline)

  // KPI는 화면에 보이는(필터 적용된) 매입처 기준으로 집계
  const kpi = useMemo(() => {
    const active = visible.filter(r => r.invoice_count > 0 || r.erp_amount > 0)
    const inv = active.reduce((s, r) => s + r.invoice_total, 0)
    const paid = active.reduce((s, r) => s + r.paid_amount, 0)
    return {
      active_vendors: active.length,
      invoice_total: inv,
      paid_total: paid,
      // 별도 구매처는 즉시 결제라 미지급 지표에서 제외 (경비성은 지급 의무가 있어 포함) — 602
      outstanding_total: visible.reduce((s, r) => s + (r.purchase_kind === 'retail' ? 0 : Math.max(0, r.outstanding)), 0),
      over90_total: visible.reduce((s, r) => s + (r.purchase_kind === 'retail' ? 0 : r.over90), 0),
      pay_ratio: inv > 0 ? Math.min(1, paid / inv) : 1,
    }
  }, [visible])

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">매입처 관리</h1>
          <p className="text-sm mt-1 text-gray-500">
            매입 계산서·지급·미지급 잔액과 담당을 매입처 단위로 봅니다. 행 클릭 시 매입처 360° 상세로 이동합니다.
          </p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700 shrink-0">
          매입처 등록
        </button>
      </div>
      {showNew && (
        <NewVendorModal
          showKind={canDrilldown}
          onClose={() => setShowNew(false)}
          onCreated={id => { setShowNew(false); router.push(`${basePath}/${id}?from=${from}&to=${to}`) }}
        />
      )}

      {/* 기간 빠른 선택 — 다른 목록 화면(거래내역·법인카드·ERP 주문내역)과 동일하게 필터 바 위 별도 행 */}
      <div className="flex items-center gap-1.5 flex-wrap mt-4 mb-2">
        {['당월', '1분기', '2분기', '상반기', '당년', '전체 기간'].map(p => (
          <button key={p} onClick={() => applyPreset(p)}
            className={`px-2.5 py-1 rounded-full text-xs border ${preset === p ? 'bg-slate-900 text-white border-slate-900' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {p}
          </button>
        ))}
      </div>

      {/* 필터 — 검색창이 맨 앞 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="매입처명 · ERP 별칭 · 사업자번호 검색"
          className="border border-gray-300 rounded-lg px-3 py-1 text-xs w-72" />
        <input type="date" value={from} onChange={e => { setPreset(''); setFrom(e.target.value) }}
          className="border border-gray-300 rounded px-2 py-1 text-xs" />
        <span className="text-gray-400 text-xs">~</span>
        <input type="date" value={to} onChange={e => { setPreset(''); setTo(e.target.value) }}
          className="border border-gray-300 rounded px-2 py-1 text-xs" />
        <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs">
          <option value="">담당직원: 전체</option>
          {staffNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs">
          <option value="">상태: 전체</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label className="text-xs text-gray-600 flex items-center gap-1">
          <input type="checkbox" checked={erpOnly} onChange={e => setErpOnly(e.target.checked)} /> ERP 발주 있는 곳
        </label>
        <label className="text-xs text-gray-600 flex items-center gap-1">
          <input type="checkbox" checked={outstandingOnly} onChange={e => setOutstandingOnly(e.target.checked)} /> 미지급 있는 곳만
        </label>
        <label className="text-xs text-gray-600 flex items-center gap-1" title="별도 구매처(사 온 곳)·경비성(택배·전기·리스 등) — 발주 관리 대상이 아닙니다">
          <input type="checkbox" checked={hideOnline} onChange={e => setHideOnline(e.target.checked)} /> 거래 매입처만
        </label>
      </div>

      {/* KPI — 필터 적용된 목록 기준으로 집계 */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="text-xs text-gray-500">활성 매입처{filterActive && <span className="ml-1 text-blue-600 font-semibold">(필터 적용)</span>}</div>
            <div className="text-xl font-bold mt-0.5">{kpi.active_vendors.toLocaleString()}곳</div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {filterActive ? `전체 ${summary.active_vendors.toLocaleString()}곳 중` : '기간 내 계산서·ERP 발주 발생 기준'}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="text-xs text-gray-500">기간 매입 (계산서 총액)</div>
            <div className="text-xl font-bold mt-0.5 tabular-nums">{eok(kpi.invoice_total)}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {filterActive ? `전체 ${eok(summary.invoice_total)} 중` : '부가세 포함, 발행일 기준'}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="text-xs text-gray-500">지급율 (기간)</div>
            <div className="text-xl font-bold mt-0.5 tabular-nums">{(kpi.pay_ratio * 100).toFixed(1)}%</div>
            <div className="text-[11px] text-gray-400 mt-0.5">지급 {eok(kpi.paid_total)}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="text-xs text-gray-500">미지급 잔액 (누적)</div>
            <div className="text-xl font-bold mt-0.5 tabular-nums text-red-600">{eok(kpi.outstanding_total)}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">90일 초과 {eok(kpi.over90_total)} 포함</div>
          </div>
        </div>
      )}

      {/* 미연결 큐 알림 — 별칭·거래처 연결이 빠진 원본은 집계에서 빠진다 */}
      {summary && (summary.unlinked_items > 0 || summary.unlinked_aliases > 0) && (
        <div className="mt-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          ERP 품목 중 매입처 표기만 있고 별칭 미연결 {summary.unlinked_items.toLocaleString()}건
          {summary.unlinked_aliases > 0 && <> · 거래처 미연결 매입 별칭 {summary.unlinked_aliases.toLocaleString()}개</>}
          {' — 이 분량은 매입처 집계에서 빠져 있습니다.'}
          {canDrilldown && <> <Link href="/erp-aliases?type=purchase" className="underline font-semibold">매입처 연결 키워드에서 연결</Link></>}
        </div>
      )}

      {error && <div className="mt-4 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      {/* 목록 */}
      <div className="bg-white border border-gray-200 rounded-xl mt-4 overflow-x-auto">
        {loading ? (
          <div className="text-center py-20 text-gray-400">집계 중...</div>
        ) : (
          <table className="w-full text-sm min-w-[1180px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium">매입처</th>
                <th className="py-2 px-3 text-left font-medium">발주 이메일</th>
                <th className="py-2 px-3 text-left font-medium">담당직원</th>
                <th className="py-2 px-3 text-left font-medium">거래처 담당자</th>
                <th className="py-2 px-3 text-right font-medium">기간 매입</th>
                <th className="py-2 px-3 text-right font-medium">지급액</th>
                <th className="py-2 px-3 text-left font-medium w-32">지급율</th>
                <th className="py-2 px-3 text-right font-medium">ERP 발주</th>
                <th className="py-2 px-3 text-right font-medium">미지급 잔액</th>
                <th className="py-2 px-3 text-left font-medium">최근 매입</th>
                <th className="py-2 px-3 text-left font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 300).map(r => {
                const ratio = r.invoice_total > 0 ? Math.min(1, r.paid_amount / r.invoice_total) : 1
                const meta = STATUS_META[r.status] ?? STATUS_META.normal
                return (
                  <tr key={r.vendor_id} className="border-b border-gray-50 hover:bg-blue-50/40">
                    <td className="py-2 px-3">
                      <Link href={`${basePath}/${r.vendor_id}?from=${from}&to=${to}`} className="block">
                        <div className="font-semibold text-gray-900">{r.vendor_name}</div>
                        <div className="text-[11px] text-gray-400">
                          {r.purchase_kind === 'expense' && <span className="text-amber-700 font-medium">경비성 · </span>}
                          별칭 {r.alias_count || '-'}{r.opening_remain > 0 ? ` · 기초이월 ${eok(r.opening_remain)}` : ''}
                        </div>
                      </Link>
                    </td>
                    <td className="py-2 px-3">
                      {r.email
                        ? <a href={`mailto:${r.email}`} title={r.email}
                            className="text-blue-600 hover:underline text-xs block max-w-[180px] truncate">{r.email}</a>
                        : r.purchase_kind !== 'partner'
                          ? <span className="text-gray-300 text-[11px]" title="발주 대상이 아닙니다">-</span>
                          : <span className="text-orange-600 text-[11px]">미입력</span>}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {r.staff_primary ?? <span className="text-gray-300">-</span>}
                      {r.staff_extra > 0 && <span className="ml-1 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px] font-bold">+{r.staff_extra}</span>}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {r.contact_rep ?? <span className="text-gray-300">-</span>}
                      {r.contact_extra > 0 && <span className="ml-1 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px] font-bold">+{r.contact_extra}</span>}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{won(r.invoice_total)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{won(r.paid_amount)}</td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-600 rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                        </div>
                        <span className="tabular-nums text-xs">{(ratio * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-500">{r.erp_amount > 0 ? won(r.erp_amount) : <span className="text-gray-300">-</span>}</td>
                    <td className={`py-2 px-3 text-right tabular-nums ${r.purchase_kind === 'retail' ? 'text-gray-300' : r.outstanding > 0 ? 'text-red-600 font-medium' : r.outstanding < 0 ? 'text-violet-600 font-medium' : 'text-gray-400'}`}
                      title={r.purchase_kind === 'retail' ? '별도 구매처 — 즉시 결제라 미지급 관리 대상이 아닙니다' : undefined}>
                      {won(r.outstanding)}
                    </td>
                    <td className="py-2 px-3 tabular-nums text-gray-500 text-xs">{r.last_purchase_date ?? '-'}</td>
                    <td className="py-2 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
                    </td>
                  </tr>
                )
              })}
              {!visible.length && (
                <tr><td colSpan={11} className="text-center py-14 text-gray-400 text-sm">조건에 맞는 매입처가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-2">
        {visible.length > 300 ? `상위 300곳만 표시 중 (전체 ${visible.length.toLocaleString()}곳 — 검색·필터로 좁혀주세요) · ` : `${visible.length.toLocaleString()}곳 · `}
        매입·미지급은 매입 계산서·출금 매칭 원본 기준 (음수 잔액 = 과다지급) · 휴면 = 최근 6개월 매입 없음
      </p>
    </div>
  )
}
