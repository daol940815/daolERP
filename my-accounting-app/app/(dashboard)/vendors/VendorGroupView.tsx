'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Vendor } from '@/types/tax-invoice'

const GROUP_META: Record<string, {
  title: string; sub: string; color: string
  types: string[]; defaultType: 'vendor' | 'customer'
  addLabel: string
}> = {
  customers: {
    title: '매출처 관리',
    sub: '세금계산서를 발행하고 수금하는 거래처를 등록·관리합니다.',
    color: 'text-blue-700',
    types: ['customer', 'both'],
    defaultType: 'customer',
    addLabel: '+ 매출처 추가',
  },
  suppliers: {
    title: '매입처 관리',
    sub: '세금계산서를 수취하고 대금을 결제하는 거래처를 등록·관리합니다.',
    color: 'text-orange-700',
    types: ['vendor', 'both'],
    defaultType: 'vendor',
    addLabel: '+ 매입처 추가',
  },
}

const TYPE_META: Record<string, { label: string; cls: string }> = {
  vendor:   { label: '매입처',     cls: 'bg-orange-100 text-orange-700' },
  customer: { label: '매출처',     cls: 'bg-blue-100 text-blue-700' },
  both:     { label: '매입+매출',  cls: 'bg-purple-100 text-purple-700' },
}

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

// ── 카드번호 칩 입력 (카드매출 매칭용 마스킹된 카드번호) ─────────────
function CardNumberChips({
  cardNumbers,
  onRemove,
  onAdd,
}: {
  cardNumbers: string[]
  onRemove: (card: string) => void
  onAdd: (card: string) => void
}) {
  const [input, setInput] = useState('')

  const handleAdd = () => {
    const card = input.trim()
    if (!card || cardNumbers.includes(card)) { setInput(''); return }
    onAdd(card)
    setInput('')
  }

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {cardNumbers.map(card => (
        <span
          key={card}
          className="group inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-700 font-mono hover:bg-gray-200"
        >
          {card}
          <button
            onClick={() => onRemove(card)}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 leading-none transition-opacity"
          >
            ✕
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
        onBlur={handleAdd}
        placeholder="+ 4025-96**-****-0302"
        className="text-xs px-2 py-0.5 border border-dashed border-gray-300 rounded w-44 focus:outline-none focus:border-slate-500 text-gray-500 placeholder-gray-400 font-mono"
      />
    </div>
  )
}

// ── 거래처 등록/수정 모달 ──────────────────────────────────────────
function VendorModal({
  vendor, defaultType, onClose, onSaved,
}: {
  vendor: Vendor | null
  defaultType: 'vendor' | 'customer'
  onClose: () => void
  onSaved: (v: Vendor) => void
}) {
  const [form, setForm] = useState({
    name:          vendor?.name ?? '',
    biz_number:    vendor?.biz_number ?? '',
    type:          vendor?.type ?? defaultType,
    contact_name:  vendor?.contact_name ?? '',
    contact_phone: vendor?.contact_phone ?? '',
    email:         vendor?.email ?? '',
    note:          vendor?.note ?? '',
    match_aliases: vendor?.match_aliases ?? [] as string[],
    card_numbers:  vendor?.card_numbers ?? [] as string[],
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">카드번호</label>
            <p className="text-xs text-gray-400 mb-1.5">카드 매출 상세내역의 마스킹된 카드번호를 등록하면 카드결제내역(매출) 자동 매칭에 활용됩니다.</p>
            <CardNumberChips
              cardNumbers={form.card_numbers}
              onAdd={card => setForm(f => ({ ...f, card_numbers: [...f.card_numbers, card] }))}
              onRemove={card => setForm(f => ({ ...f, card_numbers: f.card_numbers.filter(c => c !== card) }))}
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

export default function VendorGroupView({ group }: { group: 'customers' | 'suppliers' }) {
  const meta = GROUP_META[group]

  const [vendors, setVendors]   = useState<Vendor[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [showAdd, setShowAdd]   = useState(false)
  const [editing, setEditing]   = useState<Vendor | null>(null)
  const [toast, setToast]       = useState<string | null>(null)

  const showMsg = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const loadVendors = useCallback(async () => {
    if (!meta) return
    setLoading(true)
    const params = new URLSearchParams({ all: 'true', type: meta.types.join(',') })
    if (search.trim()) params.set('q', search.trim())
    const res = await fetch(`/api/vendors?${params.toString()}`)
    const json = await res.json()
    if (Array.isArray(json.data)) setVendors(json.data)
    setLoading(false)
  }, [meta, search])

  useEffect(() => {
    const t = setTimeout(loadVendors, 250)
    return () => clearTimeout(t)
  }, [loadVendors])

  if (!meta) {
    return <div className="text-center py-20 text-gray-400 text-sm">잘못된 경로입니다.</div>
  }

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
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{meta.title}</h1>
          <p className={`text-sm mt-1 ${meta.color} font-medium`}>{meta.sub}</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700"
        >
          {meta.addLabel}
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4 mt-4 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="거래처명 또는 사업자번호 검색"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : vendors.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">등록된 거래처가 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {vendors.map(v => {
            const tmeta = TYPE_META[v.type] ?? { label: v.type, cls: 'bg-gray-100 text-gray-600' }
            return (
              <Link
                key={v.id}
                href={`/vendors/${v.id}`}
                className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 ${!v.is_active ? 'opacity-50' : ''}`}
              >
                <span className={`px-2 py-0.5 rounded text-xs font-semibold shrink-0 ${tmeta.cls}`}>{tmeta.label}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{v.name}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {v.biz_number ?? '사업자번호 미등록'}
                    {v.contact_name && ` · ${v.contact_name}`}
                    {v.contact_phone && ` · ${v.contact_phone}`}
                  </p>
                </div>
                <div
                  className="flex items-center gap-1 shrink-0"
                  onClick={e => { e.preventDefault(); e.stopPropagation() }}
                >
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
              </Link>
            )
          })}
        </div>
      )}

      {showAdd && (
        <VendorModal
          vendor={null}
          defaultType={meta.defaultType}
          onClose={() => setShowAdd(false)}
          onSaved={v => { setVendors(prev => [...prev, v].sort((a, b) => a.name.localeCompare(b.name))); showMsg(`'${v.name}' 등록됨`) }}
        />
      )}
      {editing && (
        <VendorModal
          vendor={editing}
          defaultType={meta.defaultType}
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
