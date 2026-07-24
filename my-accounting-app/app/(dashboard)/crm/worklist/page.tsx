'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ACTIVITY_TYPES } from '@/types/crm'

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

type ContactLite = {
  id: string; bank_name: string; branch_name: string | null; name: string
  title: string | null; phone: string | null; counselor_now: string | null
}
type Followup = {
  id: string; contact_id: string; activity_date: string; activity_type: string
  staff_name: string | null; summary: string | null
  next_action_date: string; next_action_memo: string | null; contact: ContactLite
}
type RiskRow = ContactLite & {
  contact_id: string; total_revenue: number; revenue_grade: string
  last_order_date: string | null; last_activity: string | null
}

function ContactLink({ c, id }: { c: ContactLite; id: string }) {
  return (
    <Link href={`/crm/${id}`} className="text-gray-900 hover:underline">
      {c.bank_name}
      {c.branch_name && <span className="text-gray-400 text-xs ml-1">{c.branch_name}</span>}
      <span className="ml-1.5 font-medium">{c.name}</span>
      {c.title && <span className="text-gray-400 text-xs ml-1">{c.title}</span>}
    </Link>
  )
}

// 관리 워크리스트: 오늘 해야 할 고객 관리 3종
export default function CrmWorklistPage() {
  const [followups, setFollowups] = useState<Followup[]>([])
  const [churnRisk, setChurnRisk] = useState<RiskRow[]>([])
  const [noIntimacy, setNoIntimacy] = useState<RiskRow[]>([])
  const [refYear, setRefYear] = useState<number>(new Date().getFullYear())
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/crm/worklist')
    const json = await res.json()
    if (json.error) setMsg(`조회 실패: ${json.error}`)
    else {
      setFollowups(json.followups ?? [])
      setChurnRisk(json.churn_risk ?? [])
      setNoIntimacy(json.no_intimacy ?? [])
      setRefYear(json.ref_year)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4">
        <Link href="/crm" className="text-xs text-slate-500 hover:text-slate-700">← 고객 목록</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">관리 워크리스트</h1>
        <p className="text-sm mt-1 text-gray-500">팔로업 도래 · 이탈 위험 · 친밀도 입력 우선순위 — 오늘 할 고객 관리</p>
      </div>

      {msg && <div className="mb-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : (
        <div className="space-y-8">
          {/* 1. 팔로업 도래 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-2">
              다음 할 일 도래 <span className="text-xs text-gray-400 font-normal">(7일 이내 + 경과, {followups.length}건)</span>
            </h2>
            {followups.length === 0 ? (
              <p className="text-sm text-gray-400 border border-gray-200 rounded-xl py-6 text-center">도래한 할 일이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {followups.map(f => (
                  <div key={f.id} className={`border rounded-lg px-4 py-2.5 text-sm flex items-center justify-between ${f.next_action_date < today ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}>
                    <div>
                      <ContactLink c={f.contact} id={f.contact_id} />
                      <p className="text-xs text-gray-500 mt-0.5">
                        <span className={f.next_action_date < today ? 'text-red-600 font-medium' : 'text-amber-600'}>
                          {f.next_action_date}{f.next_action_date < today && ' (경과)'}
                        </span>
                        {' — '}{f.next_action_memo ?? '(메모 없음)'}
                        <span className="text-gray-400 ml-2">
                          이전 활동: {f.activity_date} {ACTIVITY_TYPES[f.activity_type] ?? f.activity_type} {f.summary ?? ''}
                        </span>
                      </p>
                    </div>
                    {f.contact.phone && <span className="text-xs text-gray-500 shrink-0 ml-3">{f.contact.phone}</span>}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 2. 이탈 위험 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-2">
              이탈 위험 <span className="text-xs text-gray-400 font-normal">({refYear - 1}년 거래 · {refYear}년 미거래, 매출 상위 {churnRisk.length}명)</span>
            </h2>
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                    <th className="py-2.5 px-3 font-medium">고객</th>
                    <th className="py-2.5 px-3 font-medium">상담자</th>
                    <th className="py-2.5 px-3 font-medium text-right">누적매출</th>
                    <th className="py-2.5 px-3 font-medium">마지막 주문</th>
                    <th className="py-2.5 px-3 font-medium">최종 관리</th>
                  </tr>
                </thead>
                <tbody>
                  {churnRisk.map(r => (
                    <tr key={r.contact_id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3"><ContactLink c={r} id={r.contact_id} /></td>
                      <td className="py-2 px-3 text-xs text-gray-600">{r.counselor_now ?? '-'}</td>
                      <td className="py-2 px-3 text-right font-medium">{won(r.total_revenue)}</td>
                      <td className="py-2 px-3 text-xs text-gray-500">{r.last_order_date ?? '-'}</td>
                      <td className="py-2 px-3 text-xs text-gray-500">{r.last_activity ?? '-'}</td>
                    </tr>
                  ))}
                  {churnRisk.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-gray-400 text-sm">이탈 위험 고객이 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {/* 3. 친밀도 미입력 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-2">
              친밀도 입력 필요 <span className="text-xs text-gray-400 font-normal">(매출 A·B등급 &amp; {refYear}년 거래, {noIntimacy.length}명)</span>
            </h2>
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                    <th className="py-2.5 px-3 font-medium">고객</th>
                    <th className="py-2.5 px-3 font-medium">상담자</th>
                    <th className="py-2.5 px-3 font-medium text-center">매출등급</th>
                    <th className="py-2.5 px-3 font-medium text-right">누적매출</th>
                  </tr>
                </thead>
                <tbody>
                  {noIntimacy.map(r => (
                    <tr key={r.contact_id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3"><ContactLink c={r} id={r.contact_id} /></td>
                      <td className="py-2 px-3 text-xs text-gray-600">{r.counselor_now ?? '-'}</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${r.revenue_grade === 'A' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{r.revenue_grade}</span>
                      </td>
                      <td className="py-2 px-3 text-right font-medium">{won(r.total_revenue)}</td>
                    </tr>
                  ))}
                  {noIntimacy.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-gray-400 text-sm">전부 입력되었습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
