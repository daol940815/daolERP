'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Vendor, TaxInvoice } from '@/types/tax-invoice'

const TYPE_META: Record<string, { label: string; cls: string }> = {
  vendor:   { label: '매입처',     cls: 'bg-orange-100 text-orange-700' },
  customer: { label: '매출처',     cls: 'bg-blue-100 text-blue-700' },
  both:     { label: '매입+매출',  cls: 'bg-purple-100 text-purple-700' },
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

// ── 매칭 별칭 칩 입력 (입금자명 등 학습된 표현) ─────────────────────
function AliasChips({
  aliases,
  onRemove,
  onAdd,
}: {
  aliases: string[]
  onRemove: (alias: string) => void
  onAdd: (alias: string) => void
}) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleAdd = () => {
    const alias = input.trim()
    if (!alias || aliases.includes(alias)) { setInput(''); return }
    onAdd(alias)
    setInput('')
  }

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {aliases.map(alias => (
        <span
          key={alias}
          className="group inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-700 hover:bg-gray-200"
        >
          {alias}
          <button
            onClick={() => onRemove(alias)}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 leading-none transition-opacity"
          >
            ✕
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
        onBlur={handleAdd}
        placeholder="+ 별칭"
        className="text-xs px-2 py-0.5 border border-dashed border-gray-300 rounded w-20 focus:outline-none focus:border-slate-500 text-gray-500 placeholder-gray-400"
      />
    </div>
  )
}

// ── 거래처 등록/수정 모달 ──────────────────────────────────────────
function VendorModal({
  vendor, onClose, onSaved,
}: {
  vendor: Vendor | null
  onClose: () => void
  onSaved: (v: Vendor) => void
}) {
  const [form, setForm] = useState({
    name:          vendor?.name ?? '',
    biz_number:    vendor?.biz_number ?? '',
    type:          vendor?.type ?? 'vendor',
    contact_name:  vendor?.contact_name ?? '',
    contact_phone: vendor?.contact_phone ?? '',
    email:         vendor?.email ?? '',
    note:          vendor?.note ?? '',
    match_aliases: vendor?.match_aliases ?? [] as string[],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const handleSave = async () => {
    if (!form.name.trim()) { setError('거래처명은 필수입니다.'); return }
    setSaving(true)
    setError(null)
    const url    = vendor ? `/api/vendors/${vendor.id}` : '/api/vendors'
    const method = vendor ? 'PATCH' : 'POST'
    const res  = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { setError(json.error ?? '저장 실패'); return }
    onSaved(json.data)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-4">{vendor ? '거래처 수정' : '거래처 추가'}</h2>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">거래처명 <span className="text-red-500">*</span></label>
            <input
              autoFocus
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">사업자등록번호</label>
              <input
                value={form.biz_number}
                onChange={e => setForm(f => ({ ...f, biz_number: e.target.value }))}
                placeholder="000-00-00000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">유형</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as 'vendor' | 'customer' | 'both' }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="vendor">매입처</option>
                <option value="customer">매출처</option>
                <option value="both">매입+매출</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">담당자</label>
              <input
                value={form.contact_name}
                onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
              <input
                value={form.contact_phone}
                onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
            <input
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">메모</label>
            <textarea
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">매칭 별칭</label>
            <p className="text-xs text-gray-400 mb-1.5">입금자명 등 거래내역 적요에 등장하는 표현을 등록하면 자동 매칭에 활용됩니다.</p>
            <AliasChips
              aliases={form.match_aliases}
              onAdd={alias => setForm(f => ({ ...f, match_aliases: [...f.match_aliases, alias] }))}
              onRemove={alias => setForm(f => ({ ...f, match_aliases: f.match_aliases.filter(a => a !== alias) }))}
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">취소</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 거래처별 세금계산서 요약 (받을 돈 / 줄 돈 현황) ─────────────────
function VendorSummary({ vendorId }: { vendorId: string }) {
  const [invoices, setInvoices] = useState<TaxInvoice[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/tax-invoices?vendorId=${vendorId}&limit=5000`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setInvoices(Array.isArray(d.data) ? d.data : []) })
      .catch(() => { if (!cancelled) setInvoices([]) })
    return () => { cancelled = true }
  }, [vendorId])

  if (invoices === null) {
    return <div className="py-4 text-center text-xs text-gray-400">불러오는 중...</div>
  }
  if (invoices.length === 0) {
    return <div className="py-4 text-center text-xs text-gray-400">연결된 세금계산서가 없습니다.</div>
  }

  const summarize = (list: TaxInvoice[]) => {
    const total    = list.reduce((s, i) => s + (i.total_amount || 0), 0)
    const matched  = list.filter(i => i.payment_status === 'matched')
    const matchedAmt = matched.reduce((s, i) => s + (i.total_amount || 0), 0)
    return { count: list.length, total, matchedCount: matched.length, matchedAmt, remaining: total - matchedAmt }
  }

  const sales    = summarize(invoices.filter(i => i.direction === 'sales'))
  const purchase = summarize(invoices.filter(i => i.direction === 'purchase'))

  const Card = ({ label, sub, color, s }: { label: string; sub: string; color: string; s: ReturnType<typeof summarize> }) => (
    <div className="border border-gray-200 rounded-lg p-3 flex-1 min-w-[220px]">
      <p className={`text-xs font-semibold ${color} mb-1.5`}>{label} <span className="text-gray-400 font-normal">· {sub}</span></p>
      {s.count === 0 ? (
        <p className="text-xs text-gray-400">내역 없음</p>
      ) : (
        <div className="space-y-0.5 text-xs text-gray-600">
          <p>발행 합계 <span className="font-medium text-gray-900">{won(s.total)}</span> ({s.count}건)</p>
          <p className="text-green-600">확인됨 {won(s.matchedAmt)} ({s.matchedCount}건)</p>
          <p className={s.remaining > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>
            {sub === '받을 돈' ? '미수' : '미지급'} 잔액 {won(s.remaining)}
          </p>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex gap-3 flex-wrap">
      <Card label="매출 세금계산서" sub="받을 돈"  color="text-blue-700"   s={sales} />
      <Card label="매입 세금계산서" sub="줄 돈"    color="text-orange-700" s={purchase} />
    </div>
  )
}

export default function VendorsPage() {
  const [vendors, setVendors]   = useState<Vendor[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [showAdd, setShowAdd]   = useState(false)
  const [editing, setEditing]   = useState<Vendor | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [toast, setToast]       = useState<string | null>(null)

  const showMsg = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const loadVendors = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ all: 'true' })
    if (search.trim()) params.set('q', search.trim())
    if (typeFilter !== 'all') params.set('type', typeFilter)
    const res = await fetch(`/api/vendors?${params.toString()}`)
    const json = await res.json()
    if (Array.isArray(json.data)) setVendors(json.data)
    setLoading(false)
  }, [search, typeFilter])

  useEffect(() => {
    const t = setTimeout(loadVendors, 250)
    return () => clearTimeout(t)
  }, [loadVendors])

  const handleToggleActive = async (v: Vendor) => {
    const res = await fetch(`/api/vendors/${v.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !v.is_active }),
    })
    const json = await res.json()
    if (res.ok && json.data) {
      setVendors(prev => prev.map(x => x.id === v.id ? json.data : x))
      showMsg(v.is_active ? '비활성화됨' : '활성화됨')
    }
  }

  const handleDelete = async (v: Vendor) => {
    if (!window.confirm(`'${v.name}' 거래처를 삭제하시겠습니까?\n연결된 거래내역·세금계산서의 거래처 정보는 해제됩니다.`)) return
    const res = await fetch(`/api/vendors/${v.id}`, { method: 'DELETE' })
    if (res.ok) {
      setVendors(prev => prev.filter(x => x.id !== v.id))
      showMsg(`'${v.name}' 삭제됨`)
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">거래처 관리</h1>
          <p className="text-gray-500 text-sm mt-1">
            거래처를 등록하고 세금계산서·입출금 내역을 매칭해 미수/미지급 현황을 확인합니다.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700"
        >
          + 거래처 추가
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="거래처명 또는 사업자번호 검색"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <div className="flex gap-1">
          {[
            { key: 'all', label: '전체' },
            { key: 'vendor', label: '매입처' },
            { key: 'customer', label: '매출처' },
            { key: 'both', label: '매입+매출' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setTypeFilter(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                typeFilter === tab.key ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : vendors.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">등록된 거래처가 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {vendors.map(v => {
            const meta = TYPE_META[v.type] ?? { label: v.type, cls: 'bg-gray-100 text-gray-600' }
            const isOpen = expanded === v.id
            return (
              <div key={v.id} className="border-b border-gray-100 last:border-b-0">
                <div
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 ${!v.is_active ? 'opacity-50' : ''}`}
                  onClick={() => setExpanded(isOpen ? null : v.id)}
                >
                  <span className="text-xs text-gray-400 w-3 shrink-0">{isOpen ? '▾' : '▸'}</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold shrink-0 ${meta.cls}`}>{meta.label}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{v.name}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {v.biz_number ?? '사업자번호 미등록'}
                      {v.contact_name && ` · ${v.contact_name}`}
                      {v.contact_phone && ` · ${v.contact_phone}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => handleToggleActive(v)}
                      className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                      title={v.is_active ? '비활성화' : '활성화'}
                    >
                      {v.is_active ? '활성' : '비활성'}
                    </button>
                    <button
                      onClick={() => setEditing(v)}
                      className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDelete(v)}
                      className="px-2 py-1 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                    >
                      삭제
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div className="px-4 pb-4 pl-10">
                    {v.note && <p className="text-xs text-gray-500 mb-2">{v.note}</p>}
                    <VendorSummary vendorId={v.id} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showAdd && (
        <VendorModal
          vendor={null}
          onClose={() => setShowAdd(false)}
          onSaved={v => { setVendors(prev => [...prev, v].sort((a, b) => a.name.localeCompare(b.name))); showMsg(`'${v.name}' 등록됨`) }}
        />
      )}
      {editing && (
        <VendorModal
          vendor={editing}
          onClose={() => setEditing(null)}
          onSaved={v => { setVendors(prev => prev.map(x => x.id === v.id ? v : x)); showMsg(`'${v.name}' 수정됨`) }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
