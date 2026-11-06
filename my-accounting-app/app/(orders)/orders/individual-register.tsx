'use client'

import { useState } from 'react'
import { contactLabel } from '@/lib/contact-label'
import type { IndividualCustomerOpt } from './form-shared'

// 신규 개인 고객 등록 (115, 시안 docs/mockups/개인고객_분리_시안.html 탭 2)
// 같은 이름의 개인 고객이 있으면 경고 — 같은 분이면 그 고객을 고르고, 다른 분이면 전화번호를 넣어야 등록된다.
// 등록하면 인물 + 고객 전용 매출처("개인 {이름}")가 함께 생긴다.
export default function IndividualRegister({ groupId, employees, initial, onDone, onPick, onCancel }: {
  groupId: string
  employees: { id: string; name: string }[]
  initial?: { name?: string; title?: string; phone?: string }
  onDone: (r: { vendor_id: string; contact_id: string; staff_employee_id: string; phone: string }) => void
  onPick: (c: IndividualCustomerOpt) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [staff, setStaff] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [dups, setDups] = useState<IndividualCustomerOpt[]>([])
  const label = 'block text-[0.6875rem] font-medium text-gray-500 mb-0.5'
  const inp = 'border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm'

  const submit = async (forceNew: boolean) => {
    if (!name.trim() || !staff) return
    setBusy(true); setMsg(null)
    const res = await fetch('/api/orders-portal/masters', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_individual', group_id: groupId, name: name.trim(), title: title.trim(), phone: phone.trim(), staff_employee_id: staff, force_new: forceNew }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.status === 409) { setDups(json.duplicates ?? []); setMsg(json.error ?? null); return }
    if (!res.ok) { setMsg(json.error ?? '등록 실패'); return }
    onDone({ vendor_id: json.vendor_id, contact_id: json.contact_id, staff_employee_id: staff, phone: phone.trim() })
  }

  return (
    <div className="mt-3 p-3 bg-blue-50/50 border border-blue-200 rounded-lg">
      <div className="text-xs font-semibold text-blue-800 mb-2">
        신규 개인 고객 등록 <span className="font-normal text-gray-500 ml-1">등록하면 고객 전용 매출처(개인 {name.trim() || '이름'})가 자동으로 생깁니다</span>
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className={label}>이름 *</label>
          <input value={name} onChange={e => { setName(e.target.value); setDups([]) }} className={`${inp} w-32`} placeholder="직함 제외" />
        </div>
        <div>
          <label className={label}>직함</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className={`${inp} w-28`} placeholder="(선택)" />
        </div>
        <div>
          <label className={label}>휴대폰 {dups.length > 0 && <em className="not-italic text-red-500">*</em>}</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} className={`${inp} w-36`} placeholder="010-" />
        </div>
        <div>
          <label className={label}>다올 담당 *</label>
          <select value={staff} onChange={e => setStaff(e.target.value)} className={`${inp} w-36 bg-white`}>
            <option value="">선택</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        {dups.length === 0 ? (
          <button type="button" disabled={busy || !name.trim() || !staff} onClick={() => submit(false)}
            className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm disabled:opacity-50">{busy ? '등록 중...' : '등록'}</button>
        ) : (
          <button type="button" disabled={busy || !phone.trim() || !staff} onClick={() => submit(true)}
            className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm disabled:opacity-50">다른 분 — 새로 등록</button>
        )}
        <button type="button" onClick={onCancel} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600">취소</button>
      </div>
      {dups.length > 0 && (
        <div className="mt-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg text-xs text-orange-800">
          <div className="mb-1">{msg}</div>
          {dups.map(d => (
            <div key={d.contact_id} className="flex items-center gap-2 py-0.5">
              <b>{contactLabel(d.name, d.title)}</b>
              <span className="text-orange-700/80">
                {[d.phone, employees.find(e => e.id === d.staff_employee_id)?.name && `다올 ${employees.find(e => e.id === d.staff_employee_id)?.name}`, d.code].filter(Boolean).join(' · ')}
              </span>
              <button type="button" onClick={() => onPick(d)} className="ml-auto text-blue-700 underline">이 고객으로 선택</button>
            </div>
          ))}
        </div>
      )}
      {msg && dups.length === 0 && <div className="mt-2 text-xs text-red-600">{msg}</div>}
    </div>
  )
}
