'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { contactLabel, honorify } from '@/lib/contact-label'

// 품목 수정 화면의 매입처 담당자 · 연락처 · 이메일 (2026-11-10 사용자 확정)
// - (가) 매입처 정보(vendors)를 보여 주고, 빈 칸만 (나) 거래처 담당자의 대표 담당자로 채워 출처를 표시
// - 저장 = 매입처 정보 자체 수정(그 매입처의 모든 품목에 적용), 품목에는 저장하지 않음
// - 매입처 미연결: 입력 막고 안내 + 연결할 곳 링크 / 매입처 관리 수정 권한 없음: 읽기 전용

type Key = 'contact_name' | 'contact_phone' | 'email'
type Source = 'vendor' | 'contact' | null
export interface VendorInfo {
  name: string                   // 조회한 매입처명 (저장 시 화면 입력과 같은지 확인)
  linked: boolean
  reason?: 'no_name' | 'vendor_unlinked' | 'no_alias'
  vendor?: { id: string; name: string }
  rep_title?: string | null
  fields?: Record<Key, { value: string; source: Source }>
  can_edit_vendor: boolean
  can_link: boolean
  link_contact?: string          // 연결 권한 요청처 (서버가 PERMISSION_CONTACT에서 채움)
}
export type VendorDraft = Record<Key, string>
const KEYS: [Key, string, string][] = [
  ['contact_name', '매입처 담당자', 'w-36'],
  ['contact_phone', '매입처 연락처', 'w-36'],
  ['email', '매입처 이메일', 'w-56'],
]
const EMPTY: VendorDraft = { contact_name: '', contact_phone: '', email: '' }

/** 매입처명이 바뀔 때마다(0.4초 뒤) 매입처 정보를 다시 불러온다 */
export function useVendorInfo(name: string, active: boolean) {
  const [info, setInfo] = useState<VendorInfo | null>(null)
  const [draft, setDraft] = useState<VendorDraft>(EMPTY)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!active) { setInfo(null); setDraft(EMPTY); return }
    const q = name.trim()
    let alive = true
    setLoading(true)
    const t = setTimeout(async () => {
      const res = await fetch(`/api/orders-portal/products/vendor-info?name=${encodeURIComponent(q)}`)
      const json = await res.json().catch(() => ({}))
      if (!alive) return
      setLoading(false)
      if (!res.ok) { setInfo(null); setDraft(EMPTY); return }
      const next: VendorInfo = { ...json, name: q }
      setInfo(next)
      setDraft(next.fields
        ? { contact_name: next.fields.contact_name.value, contact_phone: next.fields.contact_phone.value, email: next.fields.email.value }
        : EMPTY)
    }, 400)
    return () => { alive = false; clearTimeout(t) }
  }, [name, active])

  /** 저장할 칸 — 처음 보여 준 값에서 바뀐 칸만. (나)에서 채운 칸을 그대로 두면 저장하지 않는다 */
  const changes = (currentName: string): Partial<VendorDraft> | null => {
    if (!info?.linked || !info.fields || !info.can_edit_vendor || info.name !== currentName.trim()) return null
    const out: Partial<VendorDraft> = {}
    for (const [k] of KEYS) {
      if (draft[k].trim() !== info.fields[k].value) out[k] = draft[k].trim()
    }
    return Object.keys(out).length ? out : null
  }
  return { info, draft, setDraft, loading, changes }
}

export default function VendorInfoPanel({ info, draft, setDraft, loading, inputCls }: {
  info: VendorInfo | null
  draft: VendorDraft
  setDraft: (fn: (d: VendorDraft) => VendorDraft) => void
  loading: boolean
  inputCls: string
}) {
  const box = 'basis-full mt-1 pt-2.5 border-t border-slate-200'
  if (!info) {
    return <div className={`${box} text-xs text-gray-400`}>{loading ? '매입처 정보 불러오는 중...' : ''}</div>
  }
  if (info.reason === 'no_name') {
    return <div className={`${box} text-xs text-gray-400`}>매입처를 입력하면 매입처 담당자 · 연락처 · 이메일이 표시됩니다.</div>
  }

  const editable = info.linked && info.can_edit_vendor
  return (
    <div className={box}>
      <div className="flex items-baseline gap-2 flex-wrap mb-1.5">
        <span className="text-xs font-semibold text-gray-700">
          매입처 정보{info.vendor ? ` — ${info.vendor.name}` : ''}
        </span>
        {info.linked && editable && (
          <span className="text-[0.6875rem] text-amber-700">
            이 매입처의 모든 품목에 적용됩니다 (이메일은 발주서 발송 주소로도 쓰입니다)
          </span>
        )}
        {info.linked && !info.can_edit_vendor && (
          <span className="text-[0.6875rem] text-gray-400">읽기 전용 — 수정은 거래처 관리(매입처 관리) 수정 권한이 필요합니다</span>
        )}
        {loading && <span className="text-[0.6875rem] text-gray-400">불러오는 중...</span>}
      </div>

      {!info.linked ? (
        <div className="flex items-end gap-2.5 flex-wrap">
          {KEYS.map(([k, label, w]) => (
            <div key={k}>
              <label className="block text-[0.6875rem] text-gray-400 mb-0.5">{label}</label>
              <input disabled value="" className={`${inputCls} ${w} bg-gray-50 text-gray-400 cursor-not-allowed`} />
            </div>
          ))}
          <div className="text-xs text-orange-700 pb-2">
            <span className="font-semibold">매입처 미연결</span>
            {' '}— 이 매입처명이 매입처 관리의 매입처와 연결되지 않아 담당자 정보를 가져오거나 저장할 수 없습니다.{' '}
            {info.can_link
              ? <Link href={`/erp-aliases?type=purchase&q=${encodeURIComponent(info.name)}`} target="_blank"
                  className="underline font-semibold">매입처 연결 키워드에서 연결</Link>
              : <span>연결은 매입처 연결 키워드(회계 · 재무 › 점검 · 정리 도구)에서 합니다 — {info.link_contact ?? '경영지원팀'}에게 요청하세요.</span>}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 flex-wrap">
          {KEYS.map(([k, label, w]) => {
            const src = info.fields?.[k].source ?? null
            const fromContact = src === 'contact'
            const changed = fromContact && draft[k].trim() !== info.fields![k].value
            const shown = k === 'contact_name'
              ? (fromContact ? contactLabel(draft[k], info.rep_title) : honorify(draft[k]))
              : draft[k]
            return (
              <div key={k}>
                <label className="block text-[0.6875rem] text-gray-500 mb-0.5">{label}</label>
                {editable ? (
                  <input value={draft[k]} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))}
                    className={`${inputCls} ${w} ${fromContact && !changed ? 'border-sky-300 bg-sky-50' : ''}`}
                    placeholder="미입력" />
                ) : (
                  <div className={`${w} px-2.5 py-1.5 text-sm rounded-lg border ${fromContact ? 'border-sky-200 bg-sky-50' : 'border-gray-200 bg-gray-50'} truncate`}
                    title={shown}>
                    {shown || <span className="text-gray-400">미입력</span>}
                  </div>
                )}
                {fromContact && !changed && (
                  <div className={`${w} text-[0.625rem] text-sky-700 mt-0.5`}
                    title={editable ? '매입처 정보가 비어 있어 거래처 담당자의 대표 담당자 값을 보여 줍니다. 그대로 두면 저장하지 않고, 고치면 매입처 정보로 저장합니다.' : '매입처 정보가 비어 있어 거래처 담당자의 대표 담당자 값을 보여 줍니다.'}>
                    거래처 담당자(대표)에서 가져옴
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
