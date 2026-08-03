'use client'

// 거래처 담당자 상세 — 인물 한 명의 전체 그림
// 소속 이력(이동·진급) · 상담 직원 커넥션(자동 집계) · 영업일지 · 주문 이력

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'

const won = (n: number) => `${(n ?? 0).toLocaleString('ko-KR')}원`

interface Detail {
  contact: { id: string; name: string; phone: string | null; email: string | null; note: string | null }
  assignments: {
    id: string; vendor_id: string; vendor_name: string; title: string | null
    is_representative: boolean; started_at: string | null; ended_at: string | null; vendor_gap: boolean
  }[]
  connections: { name: string; count: number; sales: number }[]
  orders: { id: string; order_no: string; order_date: string; vendor_name: string; total_amount: number; outstanding: number }[]
  stats: { total_sales: number; outstanding: number; last_order_date: string | null; order_count: number }
  activities: { id: string; activity_date: string; activity_type: string; content: string; next_action: string | null; employee_name: string | null; vendor_name: string | null }[]
  same_name: { contact_id: string; name: string; vendor_name: string | null }[]
  employees: { id: string; name: string }[]
  migration105: boolean
}

const ACT_TYPES = ['방문', '전화', '미팅', '식사', '제안', '기타']

export default function ContactDetailPage() {
  const { contactId } = useParams<{ contactId: string }>()
  const router = useRouter()
  const [d, setD] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 정보 수정 폼
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', note: '' })

  // 이동 처리 폼
  const [moving, setMoving] = useState(false)
  const [moveQ, setMoveQ] = useState('')
  const [moveTitle, setMoveTitle] = useState('')
  const [moveOptions, setMoveOptions] = useState<{ id: string; name: string }[]>([])

  // 영업일지 폼
  const [act, setAct] = useState({ content: '', activity_type: '방문', activity_date: new Date().toISOString().slice(0, 10), next_action: '', employee_id: '' })

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000) }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/contact-manager/${contactId}`)
    const json = await res.json()
    if (res.ok) {
      setD(json)
      setForm({ name: json.contact.name ?? '', phone: json.contact.phone ?? '', email: json.contact.email ?? '', note: json.contact.note ?? '' })
    } else showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`)
    setLoading(false)
  }, [contactId])
  useEffect(() => { load() }, [load])

  // 이동 처리 — 거래처 검색 (디바운스)
  useEffect(() => {
    if (!moving || !moveQ.trim()) { setMoveOptions([]); return }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/contact-manager?search_vendor=${encodeURIComponent(moveQ.trim())}`)
      const json = await res.json()
      if (res.ok) setMoveOptions(json.vendors ?? [])
    }, 250)
    return () => clearTimeout(t)
  }, [moving, moveQ])

  const post = async (body: Record<string, unknown>, successMsg: string) => {
    setBusy(true)
    const res = await fetch('/api/contact-manager', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) { showMsg(`실패: ${json.error ?? '알 수 없는 오류'}`); return false }
    showMsg(successMsg)
    load()
    return true
  }

  if (loading) return <div className="text-center py-20 text-gray-400">로딩 중...</div>
  if (!d) return <div className="text-center py-20 text-gray-400 text-sm">담당자를 찾을 수 없습니다.</div>

  const active = d.assignments.filter(a => !a.ended_at)
  const connTotal = d.connections.reduce((s, c) => s + c.sales, 0)

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Link href="/sales-hub/contacts" className="text-sm text-gray-400 hover:text-gray-600">← 담당자 목록</Link>
        <h1 className="text-2xl font-bold text-gray-900">{d.contact.name}</h1>
        {active[0] && (
          <span className="text-sm text-gray-500">
            {active[0].vendor_name}{active[0].title ? ` · ${active[0].title}` : ''}
            {active.length > 1 && ` 외 ${active.length - 1}곳`}
          </span>
        )}
        {!active.length && <span className="px-2 py-0.5 rounded text-xs bg-red-50 text-red-600">소속 없음</span>}
      </div>

      {msg && <div className="mb-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── 좌측: 프로필 + 소속 이력 ── */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-gray-900">담당자 정보</h2>
              <button onClick={() => setEditing(e => !e)} className="text-xs text-slate-600 hover:underline">
                {editing ? '닫기' : '정보 수정'}
              </button>
            </div>
            {editing ? (
              <div className="space-y-2">
                {([['name', '이름'], ['phone', '연락처'], ['email', '이메일'], ['note', '메모']] as const).map(([k, label]) => (
                  <div key={k}>
                    <label className="block text-xs text-gray-400 mb-0.5">{label}</label>
                    <input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  </div>
                ))}
                <button disabled={busy}
                  onClick={() => post({ action: 'update_contact', contact_id: d.contact.id, ...form }, '저장되었습니다.')
                    .then(okd => okd && setEditing(false))}
                  className="w-full py-1.5 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700 disabled:opacity-40">
                  저장
                </button>
              </div>
            ) : (
              <div className="text-sm space-y-1.5">
                <div className="flex justify-between"><span className="text-gray-400 text-xs">연락처</span><span>{d.contact.phone ?? '-'}</span></div>
                <div className="flex justify-between"><span className="text-gray-400 text-xs">이메일</span><span>{d.contact.email ?? '-'}</span></div>
                <div className="flex justify-between gap-3"><span className="text-gray-400 text-xs shrink-0">메모</span><span className="text-right">{d.contact.note ?? '-'}</span></div>
                <div className="flex justify-between"><span className="text-gray-400 text-xs">마지막 주문</span>
                  <span>{d.stats.last_order_date ?? '주문 이력 없음'}</span></div>
              </div>
            )}
            <div className="flex gap-1.5 mt-3 flex-wrap">
              <button onClick={() => { setMoving(m => !m); setMoveQ(''); setMoveTitle('') }}
                className="px-2.5 py-1 text-xs border border-slate-300 text-slate-700 rounded hover:bg-slate-50">이동 처리</button>
              {d.same_name.length > 0 && (
                <button disabled={busy}
                  onClick={() => {
                    const list = d.same_name.map((s, i) => `${i + 1}. ${s.name}${s.vendor_name ? ` (${s.vendor_name})` : ' (소속 없음)'}`).join('\n')
                    const pick = window.prompt(`동명이인 후보 — 이 인물로 합칠 번호를 입력하세요.\n선택한 인물의 이력이 현재 인물(${d.contact.name})로 합쳐집니다.\n\n${list}`)
                    const idx = pick ? parseInt(pick, 10) - 1 : -1
                    if (idx < 0 || idx >= d.same_name.length) return
                    post({ action: 'merge', source_id: d.same_name[idx].contact_id, target_id: d.contact.id },
                      '병합 완료 — 이력이 이 인물로 합쳐졌습니다.')
                  }}
                  className="px-2.5 py-1 text-xs border border-violet-300 text-violet-700 rounded hover:bg-violet-50">
                  동명이인 병합 ({d.same_name.length})
                </button>
              )}
            </div>
            {moving && (
              <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
                <p className="text-xs text-gray-500">현재 배정을 모두 종료하고 새 거래처로 이동합니다. 이전 거래처는 담당 공백으로 표시됩니다.</p>
                <input autoFocus value={moveQ} onChange={e => setMoveQ(e.target.value)} placeholder="이동할 거래처 검색"
                  className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                <input value={moveTitle} onChange={e => setMoveTitle(e.target.value)} placeholder="새 직함 (예: 지점장 — 선택)"
                  className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                {moveOptions.map(v => (
                  <button key={v.id} disabled={busy}
                    onClick={() => post({ action: 'move', contact_id: d.contact.id, to_vendor_id: v.id, title: moveTitle || undefined },
                      `${v.name}(으)로 이동 처리 완료`).then(okd => okd && setMoving(false))}
                    className="block w-full text-left px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-slate-50">
                    → {v.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-sm font-bold text-gray-900 mb-3">소속 이력</h2>
            <div className="space-y-3">
              {d.assignments.map(a => (
                <div key={a.id} className={`border-l-2 pl-3 ${a.ended_at ? 'border-gray-200' : 'border-blue-500'}`}>
                  <p className="text-sm font-medium text-gray-900">
                    {a.vendor_name}{a.title ? ` · ${a.title}` : ''}
                    {a.is_representative && !a.ended_at && (
                      <span className="ml-1 px-1.5 py-0.5 rounded text-[11px] bg-blue-50 text-blue-700">대표</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400">
                    {a.started_at ?? '기존'} ~ {a.ended_at ?? '현재'}
                  </p>
                  {a.ended_at && a.vendor_gap && (
                    <p className="text-[11px] text-red-500">→ 이 거래처는 담당 공백 (후임 미지정)</p>
                  )}
                  {!a.ended_at && (
                    <div className="flex gap-1.5 mt-1">
                      {!a.is_representative && (
                        <button disabled={busy}
                          onClick={() => post({ action: 'set_representative', assignment_id: a.id, vendor_id: a.vendor_id }, '대표 담당자로 지정했습니다.')}
                          className="text-[11px] text-blue-600 hover:underline">대표 지정</button>
                      )}
                      <button disabled={busy}
                        onClick={() => window.confirm(`${a.vendor_name} 배정을 종료할까요? (퇴직·담당 해제)`) &&
                          post({ action: 'end_assignment', assignment_id: a.id }, '배정을 종료했습니다.')}
                        className="text-[11px] text-gray-400 hover:text-red-500">배정 종료</button>
                      <Link href={`/sales-hub/${a.vendor_id}`} className="text-[11px] text-slate-500 hover:underline ml-auto">허브 상세 →</Link>
                    </div>
                  )}
                </div>
              ))}
              {!d.assignments.length && <p className="text-xs text-gray-400">배정 이력이 없습니다.</p>}
            </div>
          </div>
        </div>

        {/* ── 우측 2칸: KPI + 커넥션 + 영업일지 + 주문 ── */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="border border-gray-200 rounded-lg px-4 py-3 bg-white">
              <p className="text-xs text-gray-400 mb-1">누적 매출 (귀속 주문)</p>
              <p className="text-base font-bold text-gray-900">{won(d.stats.total_sales)}</p>
            </div>
            <div className="border border-gray-200 rounded-lg px-4 py-3 bg-white">
              <p className="text-xs text-gray-400 mb-1">미수</p>
              <p className={`text-base font-bold ${d.stats.outstanding > 0 ? 'text-red-600' : 'text-gray-400'}`}>{won(d.stats.outstanding)}</p>
            </div>
            <div className="border border-gray-200 rounded-lg px-4 py-3 bg-white">
              <p className="text-xs text-gray-400 mb-1">귀속 주문 수</p>
              <p className="text-base font-bold text-gray-900">{d.stats.order_count.toLocaleString()}건</p>
            </div>
            <div className="border border-gray-200 rounded-lg px-4 py-3 bg-white">
              <p className="text-xs text-gray-400 mb-1">마지막 주문</p>
              <p className="text-base font-bold text-gray-900">{d.stats.last_order_date ?? '-'}</p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-sm font-bold text-gray-900 mb-1">상담 직원 커넥션</h2>
            <p className="text-[11px] text-gray-400 mb-3">이 담당자에게 귀속된 주문의 상담자(채널) 자동 집계 — 수동 입력 없음</p>
            {d.connections.length ? (
              <div className="space-y-1.5">
                {d.connections.map(c => (
                  <div key={c.name} className="flex items-center gap-2 text-sm">
                    <span className="w-20 shrink-0 text-gray-700">{c.name}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                      <div className="bg-blue-600 h-full rounded-full"
                        style={{ width: `${connTotal ? Math.max((c.sales / connTotal) * 100, 2) : 0}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 shrink-0 w-44 text-right">
                      주문 {c.count}건 · {won(c.sales)}
                    </span>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400">귀속된 주문이 없어 커넥션을 계산할 수 없습니다.</p>}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-sm font-bold text-gray-900 mb-1">영업 이력 (영업일지)</h2>
            {!d.migration105 ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                마이그레이션 105 실행 후 사용할 수 있습니다.
              </p>
            ) : (
              <>
                <div className="flex gap-1.5 mt-2 mb-3 flex-wrap items-center">
                  <input value={act.content} onChange={e => setAct(a => ({ ...a, content: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter' && act.content.trim()) {
                      post({ action: 'add_activity', contact_id: d.contact.id, vendor_id: active[0]?.vendor_id,
                        ...act, employee_id: act.employee_id || undefined, next_action: act.next_action || undefined },
                        '영업일지를 기록했습니다.').then(okd => okd && setAct(a => ({ ...a, content: '', next_action: '' })))
                    } }}
                    placeholder="활동 내용 (예: 화곡역지점 방문, 추석 물량 협의)"
                    className="flex-1 min-w-[220px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  <select value={act.activity_type} onChange={e => setAct(a => ({ ...a, activity_type: e.target.value }))}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                    {ACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input type="date" value={act.activity_date} onChange={e => setAct(a => ({ ...a, activity_date: e.target.value }))}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                  <select value={act.employee_id} onChange={e => setAct(a => ({ ...a, employee_id: e.target.value }))}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                    <option value="">직원 선택</option>
                    {d.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                  <input value={act.next_action} onChange={e => setAct(a => ({ ...a, next_action: e.target.value }))}
                    placeholder="다음 액션 (선택)"
                    className="w-40 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
                  <button disabled={busy || !act.content.trim()}
                    onClick={() => post({ action: 'add_activity', contact_id: d.contact.id, vendor_id: active[0]?.vendor_id,
                      ...act, employee_id: act.employee_id || undefined, next_action: act.next_action || undefined },
                      '영업일지를 기록했습니다.').then(okd => okd && setAct(a => ({ ...a, content: '', next_action: '' })))}
                    className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700 disabled:opacity-40">
                    기록
                  </button>
                </div>
                {d.activities.length ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                        <th className="py-1.5 pr-3 font-medium">일자</th>
                        <th className="py-1.5 pr-3 font-medium">직원</th>
                        <th className="py-1.5 pr-3 font-medium">유형</th>
                        <th className="py-1.5 pr-3 font-medium">내용</th>
                        <th className="py-1.5 font-medium">다음 액션</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.activities.map(a => (
                        <tr key={a.id} className="border-b border-gray-50">
                          <td className="py-1.5 pr-3 whitespace-nowrap text-xs text-gray-500">{a.activity_date}</td>
                          <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{a.employee_name ?? '-'}</td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">
                            <span className="px-1.5 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600">{a.activity_type}</span>
                          </td>
                          <td className="py-1.5 pr-3 text-gray-700">{a.content}</td>
                          <td className="py-1.5 text-xs text-gray-500">{a.next_action ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="text-xs text-gray-400">기록된 영업 이력이 없습니다. 첫 기록을 남겨보세요.</p>}
              </>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-sm font-bold text-gray-900 mb-3">
              주문 이력 <span className="text-xs text-gray-400 font-normal">담당자 표기 기준 귀속 · 최근 100건 · 클릭 시 ERP 주문내역</span>
            </h2>
            {d.orders.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="py-1.5 pr-3 font-medium">주문일</th>
                      <th className="py-1.5 pr-3 font-medium">주문번호</th>
                      <th className="py-1.5 pr-3 font-medium">거래처</th>
                      <th className="py-1.5 pr-3 font-medium text-right">금액</th>
                      <th className="py-1.5 font-medium text-right">미수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.orders.map(o => (
                      <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                        onClick={() => router.push(`/erp-orders?q=${encodeURIComponent(o.order_no)}`)}>
                        <td className="py-1.5 pr-3 whitespace-nowrap text-xs text-gray-500">{o.order_date}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap font-mono text-xs text-slate-700">{o.order_no}</td>
                        <td className="py-1.5 pr-3 max-w-[220px] truncate text-gray-700">{o.vendor_name}</td>
                        <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(o.total_amount)}</td>
                        <td className={`py-1.5 text-right whitespace-nowrap ${o.outstanding > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                          {won(o.outstanding)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-xs text-gray-400">이 담당자에게 귀속된 주문이 없습니다.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
