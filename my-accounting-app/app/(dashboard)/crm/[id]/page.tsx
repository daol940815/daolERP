'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { CrmActivity, CrmContactDetail, CrmOrderRow, CrmSalesBucket, CrmSnapshot, Grade } from '@/types/crm'
import { ACTIVITY_TYPES, GRADE_COLORS } from '@/types/crm'

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

function GradeBadge({ g }: { g: Grade | null }) {
  if (!g) return <span className="text-gray-300">-</span>
  return <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${GRADE_COLORS[g as Grade]}`}>{g}</span>
}

const SEASON_ORDER = ['설', '추석']

export default function CrmDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [contact, setContact] = useState<CrmContactDetail | null>(null)
  const [buckets, setBuckets] = useState<CrmSalesBucket[]>([])
  const [orders, setOrders] = useState<CrmOrderRow[]>([])
  const [activities, setActivities] = useState<CrmActivity[]>([])
  const [snapshots, setSnapshots] = useState<CrmSnapshot[]>([])
  const [keys, setKeys] = useState<{ id: string; bank_name: string; branch_name: string; manager_name: string; source: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})

  // 활동 등록 폼
  const today = new Date().toISOString().slice(0, 10)
  const [actForm, setActForm] = useState({ activity_date: today, activity_type: 'call', staff_name: '', summary: '', next_action_date: '', next_action_memo: '' })

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/crm/contacts/${id}`)
    const json = await res.json()
    if (json.contact) {
      setContact(json.contact)
      setBuckets(json.buckets ?? [])
      setOrders(json.orders ?? [])
      setActivities(json.activities ?? [])
      setSnapshots(json.snapshots ?? [])
      setKeys(json.keys ?? [])
    } else showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  // 매출 그리드: 연도 행 × (설·추석·월별) 열
  const grid = useMemo(() => {
    const years = new Set<number>()
    const cell = new Map<string, { amount: number; legacy: boolean }>()
    for (const b of buckets) {
      if (b.season_code) {
        const y = 2000 + parseInt(b.season_code.slice(0, 2), 10)
        const type = b.season_code.includes('설') ? '설' : '추석'
        years.add(y)
        const k = `${y}|${type}`
        const c = cell.get(k) ?? { amount: 0, legacy: false }
        c.amount += b.amount; c.legacy = c.legacy || b.legacy
        cell.set(k, c)
      } else if (b.month) {
        const y = parseInt(b.month.slice(0, 4), 10)
        years.add(y)
        const k = `${y}|${parseInt(b.month.slice(5, 7), 10)}`
        const c = cell.get(k) ?? { amount: 0, legacy: false }
        c.amount += b.amount; c.legacy = c.legacy || b.legacy
        cell.set(k, c)
      }
    }
    const yearList = Array.from(years).sort()
    const rowTotal = (y: number) => {
      let t = 0
      cell.forEach((v, k) => { if (k.startsWith(`${y}|`)) t += v.amount })
      return t
    }
    return { yearList, cell, rowTotal }
  }, [buckets])

  const totalRevenue = useMemo(() => buckets.reduce((s, b) => s + b.amount, 0), [buckets])

  const startEdit = () => {
    if (!contact) return
    setForm({
      bank_name: contact.bank_name, branch_name: contact.branch_name ?? '',
      name: contact.name, title: contact.title ?? '',
      phone: contact.phone ?? '', office_phone: contact.office_phone ?? '',
      intimacy_grade: contact.intimacy_grade ?? '', keyman: contact.keyman ?? '',
      counselor_now: contact.counselor_now ?? '', memo: contact.memo ?? '',
      is_rotc: contact.is_rotc === null ? '' : String(contact.is_rotc),
    })
    setEditing(true)
  }

  const save = async () => {
    const body: Record<string, unknown> = { ...form }
    body.is_rotc = form.is_rotc === '' ? null : form.is_rotc === 'true'
    const res = await fetch(`/api/crm/contacts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const json = await res.json()
    if (json.error) showMsg(`저장 실패: ${json.error}`)
    else { setEditing(false); showMsg('저장되었습니다.'); load() }
  }

  const addActivity = async () => {
    const res = await fetch('/api/crm/activities', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...actForm, contact_id: id }),
    })
    const json = await res.json()
    if (json.error) showMsg(`등록 실패: ${json.error}`)
    else {
      setActForm({ activity_date: today, activity_type: 'call', staff_name: actForm.staff_name, summary: '', next_action_date: '', next_action_memo: '' })
      showMsg('활동이 등록되었습니다.'); load()
    }
  }

  const removeActivity = async (aid: string) => {
    if (!confirm('이 활동 기록을 삭제할까요?')) return
    const res = await fetch(`/api/crm/activities?id=${aid}`, { method: 'DELETE' })
    const json = await res.json()
    if (json.error) showMsg(`삭제 실패: ${json.error}`)
    else load()
  }

  if (loading) return <div className="text-center py-20 text-gray-400">로딩 중...</div>
  if (!contact) return <div className="text-center py-20 text-gray-400 text-sm">고객을 찾을 수 없습니다.</div>

  const latest = snapshots[0]

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <Link href="/crm" className="text-xs text-slate-500 hover:text-slate-700">← 고객 목록</Link>
        <div className="flex items-start justify-between mt-1">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {contact.bank_name}
              {contact.branch_name && <span className="text-gray-400 text-lg ml-2">{contact.branch_name}</span>}
            </h1>
            <p className="text-lg mt-0.5 text-gray-700">
              {contact.name} {contact.title && <span className="text-gray-400 text-sm">{contact.title}</span>}
              {contact.role === 'branch_manager' && <span className="ml-1.5 px-1.5 py-0.5 rounded text-[11px] bg-indigo-100 text-indigo-700 align-middle">지점장</span>}
              {latest && (
                <span className="ml-3 align-middle text-sm text-gray-500">
                  종합 <GradeBadge g={latest.overall_grade} /> 매출 <GradeBadge g={latest.revenue_grade} /> 연속 <GradeBadge g={latest.continuity_grade} /> 친밀 <GradeBadge g={contact.intimacy_grade as Grade | null} />
                </span>
              )}
            </p>
          </div>
          {!editing && (
            <button onClick={startEdit} className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">정보 수정</button>
          )}
        </div>
      </div>

      {msg && <div className="mb-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {editing && (
        <div className="mb-5 border border-blue-200 bg-blue-50/40 rounded-xl p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {([
              ['bank_name', '거래처(은행)'], ['branch_name', '지점'], ['name', '이름'], ['title', '직급'],
              ['phone', '개인 연락처'], ['office_phone', '사무실 전화'], ['counselor_now', '상담자(현재)'], ['keyman', '키맨(소개루트)'],
            ] as const).map(([k, label]) => (
              <label key={k} className="block">
                <span className="text-xs text-gray-500">{label}</span>
                <input value={form[k] ?? ''} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                  className="mt-0.5 w-full border border-gray-300 rounded-lg px-2 py-1.5" />
              </label>
            ))}
            <label className="block">
              <span className="text-xs text-gray-500">친밀도 등급 (수기)</span>
              <select value={form.intimacy_grade ?? ''} onChange={e => setForm(f => ({ ...f, intimacy_grade: e.target.value }))}
                className="mt-0.5 w-full border border-gray-300 rounded-lg px-2 py-1.5">
                <option value="">미입력</option>
                <option value="A">A — 개인 폰 주문 + 지점 소개</option>
                <option value="B">B — 개인 폰 주문</option>
                <option value="C">C — 사무실 전화만</option>
                <option value="D">D — 낮음</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">ROTC 여부</span>
              <select value={form.is_rotc ?? ''} onChange={e => setForm(f => ({ ...f, is_rotc: e.target.value }))}
                className="mt-0.5 w-full border border-gray-300 rounded-lg px-2 py-1.5">
                <option value="">미확인</option>
                <option value="true">예</option>
                <option value="false">아니오</option>
              </select>
            </label>
            <label className="block col-span-2">
              <span className="text-xs text-gray-500">메모</span>
              <input value={form.memo ?? ''} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
                className="mt-0.5 w-full border border-gray-300 rounded-lg px-2 py-1.5" />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={save} className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700">저장</button>
            <button onClick={() => setEditing(false)} className="px-4 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm">취소</button>
          </div>
        </div>
      )}

      <div className="flex gap-3 flex-wrap mb-5 text-sm">
        <div className="border border-gray-200 rounded-lg px-4 py-3 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">누적매출 (전 기간)</p>
          <p className="text-lg font-bold text-gray-900">{won(totalRevenue)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">연락처</p>
          <p className="text-gray-700">{contact.phone ?? '-'} {contact.office_phone && <span className="text-gray-400">/ {contact.office_phone}</span>}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">상담자</p>
          <p className="text-gray-700">{contact.counselor_now ?? '-'} {contact.counselor_prev && <span className="text-gray-400 text-xs">(기존 {contact.counselor_prev})</span>}</p>
        </div>
        {contact.keyman && (
          <div className="border border-gray-200 rounded-lg px-4 py-3">
            <p className="text-xs text-gray-400 mb-1">키맨(소개루트)</p>
            <p className="text-gray-700">{contact.keyman}</p>
          </div>
        )}
        {contact.memo && (
          <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[200px]">
            <p className="text-xs text-gray-400 mb-1">메모</p>
            <p className="text-gray-700">{contact.memo}</p>
          </div>
        )}
      </div>

      {/* 매출 그리드 (엑셀 통계 행의 재현) */}
      <h2 className="text-base font-bold text-gray-900 mb-2">연도별 매출 (명절 + 월별)</h2>
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto mb-6">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 border-b border-gray-200">
              <th className="py-2 px-2 font-medium text-left">연도</th>
              {SEASON_ORDER.map(s => <th key={s} className="py-2 px-2 font-medium text-right bg-amber-50/50">{s}</th>)}
              {Array.from({ length: 12 }, (_, i) => <th key={i} className="py-2 px-2 font-medium text-right">{i + 1}월</th>)}
              <th className="py-2 px-2 font-medium text-right">합계</th>
            </tr>
          </thead>
          <tbody>
            {grid.yearList.map(y => (
              <tr key={y} className="border-b border-gray-100">
                <td className="py-1.5 px-2 font-medium text-gray-700">
                  {y}
                  {Array.from(grid.cell.keys()).some(k => k.startsWith(`${y}|`) && grid.cell.get(k)!.legacy) && (
                    <span className="ml-1 px-1 py-0.5 rounded text-[10px] bg-gray-100 text-gray-500" title="엑셀 원장에서 이관된 집계값 (라인 추적 불가)">엑셀 이관</span>
                  )}
                </td>
                {SEASON_ORDER.map(s => {
                  const c = grid.cell.get(`${y}|${s}`)
                  return <td key={s} className={`py-1.5 px-2 text-right bg-amber-50/40 ${c?.amount ? 'text-gray-900 font-medium' : 'text-gray-300'}`}>{c?.amount ? c.amount.toLocaleString() : '-'}</td>
                })}
                {Array.from({ length: 12 }, (_, i) => {
                  const c = grid.cell.get(`${y}|${i + 1}`)
                  return <td key={i} className={`py-1.5 px-2 text-right ${c?.amount ? 'text-gray-900' : 'text-gray-300'}`}>{c?.amount ? c.amount.toLocaleString() : '-'}</td>
                })}
                <td className="py-1.5 px-2 text-right font-bold text-gray-900">{grid.rowTotal(y).toLocaleString()}</td>
              </tr>
            ))}
            {grid.yearList.length === 0 && (
              <tr><td colSpan={15} className="py-6 text-center text-gray-400">매출 기록이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* 관리 활동 */}
        <div>
          <h2 className="text-base font-bold text-gray-900 mb-2">관리 활동</h2>
          <div className="border border-gray-200 rounded-xl p-3 mb-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <input type="date" value={actForm.activity_date} onChange={e => setActForm(f => ({ ...f, activity_date: e.target.value }))}
                className="border border-gray-300 rounded-lg px-2 py-1.5" />
              <select value={actForm.activity_type} onChange={e => setActForm(f => ({ ...f, activity_type: e.target.value }))}
                className="border border-gray-300 rounded-lg px-2 py-1.5">
                {Object.entries(ACTIVITY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input placeholder="담당 직원" value={actForm.staff_name} onChange={e => setActForm(f => ({ ...f, staff_name: e.target.value }))}
                className="border border-gray-300 rounded-lg px-2 py-1.5" />
              <input placeholder="요약 (예: 추석 카탈로그 발송)" value={actForm.summary} onChange={e => setActForm(f => ({ ...f, summary: e.target.value }))}
                className="border border-gray-300 rounded-lg px-2 py-1.5" />
              <input type="date" value={actForm.next_action_date} onChange={e => setActForm(f => ({ ...f, next_action_date: e.target.value }))}
                className="border border-gray-300 rounded-lg px-2 py-1.5" title="다음 할 일 날짜 (워크리스트 알림)" />
              <input placeholder="다음 할 일 메모" value={actForm.next_action_memo} onChange={e => setActForm(f => ({ ...f, next_action_memo: e.target.value }))}
                className="border border-gray-300 rounded-lg px-2 py-1.5" />
            </div>
            <button onClick={addActivity} className="mt-2 px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700">활동 등록</button>
          </div>
          <div className="space-y-2">
            {activities.map(a => (
              <div key={a.id} className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex items-start justify-between">
                <div>
                  <p className="text-gray-900">
                    <span className="text-xs text-gray-400 mr-2">{a.activity_date}</span>
                    <span className="px-1.5 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700 mr-1.5">{ACTIVITY_TYPES[a.activity_type] ?? a.activity_type}</span>
                    {a.summary ?? ''}
                    {a.staff_name && <span className="text-xs text-gray-400 ml-1.5">— {a.staff_name}</span>}
                  </p>
                  {a.next_action_date && (
                    <p className="text-xs text-amber-600 mt-0.5">다음: {a.next_action_date} {a.next_action_memo ?? ''}</p>
                  )}
                </div>
                <button onClick={() => removeActivity(a.id)} className="text-xs text-gray-300 hover:text-red-500 shrink-0 ml-2">삭제</button>
              </div>
            ))}
            {activities.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">기록된 활동이 없습니다.</p>}
          </div>
        </div>

        {/* 주문 + 등급 추이 + 키 */}
        <div>
          <h2 className="text-base font-bold text-gray-900 mb-2">주문 내역 <span className="text-xs text-gray-400 font-normal">(최근 200건)</span></h2>
          <div className="bg-white border border-gray-200 rounded-xl overflow-y-auto max-h-72 mb-5">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-gray-400 border-b border-gray-200">
                  <th className="py-2 px-3 font-medium">주문일</th>
                  <th className="py-2 px-3 font-medium">주문번호</th>
                  <th className="py-2 px-3 font-medium">구분</th>
                  <th className="py-2 px-3 font-medium text-right">금액</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="border-b border-gray-100">
                    <td className="py-1.5 px-3 text-gray-600">{o.order_date}</td>
                    <td className="py-1.5 px-3 text-gray-900">{o.order_no}</td>
                    <td className="py-1.5 px-3">
                      {o.season_code
                        ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-700">{o.season_code}</span>
                        : <span className="text-gray-400">상시</span>}
                    </td>
                    <td className="py-1.5 px-3 text-right">{o.total_amount.toLocaleString()}</td>
                  </tr>
                ))}
                {orders.length === 0 && <tr><td colSpan={4} className="py-5 text-center text-gray-400">주문이 없습니다 (2024년은 엑셀 이관 집계만 존재).</td></tr>}
              </tbody>
            </table>
          </div>

          <h2 className="text-base font-bold text-gray-900 mb-2">등급 추이 <span className="text-xs text-gray-400 font-normal">(월별 스냅샷)</span></h2>
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto mb-5">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-200">
                  <th className="py-2 px-3 font-medium">기준월</th>
                  <th className="py-2 px-3 font-medium text-center">종합</th>
                  <th className="py-2 px-3 font-medium text-center">매출</th>
                  <th className="py-2 px-3 font-medium text-center">연속</th>
                  <th className="py-2 px-3 font-medium text-center">친밀</th>
                  <th className="py-2 px-3 font-medium text-right">누적매출</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map(s => (
                  <tr key={s.eval_month} className="border-b border-gray-100">
                    <td className="py-1.5 px-3 text-gray-600">{s.eval_month}</td>
                    <td className="py-1.5 px-3 text-center"><GradeBadge g={s.overall_grade} /></td>
                    <td className="py-1.5 px-3 text-center"><GradeBadge g={s.revenue_grade} /></td>
                    <td className="py-1.5 px-3 text-center"><GradeBadge g={s.continuity_grade} /></td>
                    <td className="py-1.5 px-3 text-center"><GradeBadge g={s.intimacy_grade} /></td>
                    <td className="py-1.5 px-3 text-right">{s.total_revenue.toLocaleString()}</td>
                  </tr>
                ))}
                {snapshots.length === 0 && <tr><td colSpan={6} className="py-5 text-center text-gray-400">스냅샷이 아직 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>

          <h2 className="text-base font-bold text-gray-900 mb-2">매칭 키 <span className="text-xs text-gray-400 font-normal">(주문 자동 귀속 기준)</span></h2>
          <div className="space-y-1.5">
            {keys.map(k => (
              <p key={k.id} className="text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5">
                {k.bank_name} | {k.branch_name || '(지점 없음)'} | {k.manager_name || '(담당자 없음)'}
                <span className="ml-1.5 text-gray-400">({k.source === 'import' ? '이관' : k.source === 'manual' ? '수동' : '자동'})</span>
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
