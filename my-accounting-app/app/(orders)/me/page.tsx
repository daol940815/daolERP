'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { kstTime, LEAVE_TYPE_LABEL, LEAVE_STATUS_LABEL, type LeaveType, type LeaveStatus } from '@/lib/attendance'

// 내 대시보드 (직원 개인화면 홈)
// 본인 관련 정보만 모아 보여준다 — 이번 달 내 주문 · 미수 · 담당 거래처 ·
// 영업일지 · 오늘 근태. 숫자는 해당 화면으로 드릴다운(링크)한다.

interface Summary {
  month: string
  orders_month: { cnt: number; total: number; outstanding: number }
  outstanding_total: { outstanding: number; cnt: number }
  consult_month: { item_cnt: number; order_cnt: number }
  vendor_cnt: number
  journal: { month_cnt: number; total_cnt: number }
}

interface Data {
  me: { name: string | null; role: string; linked: boolean }
  month: string
  today: string
  summary: Summary | null
  summaryError: string | null
  recentOrders: {
    id: string; order_no: string | null; order_date: string
    customer: string; total_amount: number; outstanding_amount: number
  }[]
  recentJournal: {
    id: string; activity_date: string; activity_type: string
    content: string; contact_name: string | null; vendor_name: string | null
  }[]
  attendance: { check_in_at: string | null; check_out_at: string | null } | null
  attendanceReady: boolean
  leaves: { id: string; leave_type: LeaveType; start_date: string; end_date: string; status: LeaveStatus }[]
}

const won = (n: number) => Math.round(n).toLocaleString('ko-KR')

export default function MyDashboardPage() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/me/summary')
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? '조회 실패')
        setData(json)
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error) return <div className="px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
  if (!data) return <div className="text-center py-16 text-gray-400">로딩 중...</div>

  const s = data.summary
  const kpis = [
    {
      label: '이번 달 내 주문', href: '/orders',
      value: s ? `${s.orders_month.cnt}건` : '-',
      sub: s ? `${won(s.orders_month.total)}원` : null,
    },
    {
      label: '내 미수 잔액', href: '/orders',
      value: s ? `${won(s.outstanding_total.outstanding)}원` : '-',
      sub: s ? `미수 주문 ${s.outstanding_total.cnt}건` : null,
    },
    {
      label: '담당 거래처', href: null,
      value: s ? `${s.vendor_cnt}곳` : '-',
      sub: s && s.consult_month.order_cnt > 0 ? `이번 달 상담 주문 ${s.consult_month.order_cnt}건` : null,
    },
    {
      label: '이번 달 영업일지', href: '/me/journal',
      value: s ? `${s.journal.month_cnt}건` : '-',
      sub: s ? `누적 ${s.journal.total_cnt}건` : null,
    },
  ]

  const inTime = kstTime(data.attendance?.check_in_at ?? null)
  const outTime = kstTime(data.attendance?.check_out_at ?? null)

  return (
    <div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">내 대시보드</h1>
        <span className="text-sm text-gray-500">{data.me.name ?? ''} · {data.month}</span>
      </div>

      {!data.me.linked && (
        <div className="mt-4 px-4 py-2.5 bg-amber-50 text-amber-800 text-sm rounded-lg">
          직원 정보와 연결되지 않은 계정입니다. 직원·계정 관리에서 연결하면 본인 데이터가 표시됩니다.
        </div>
      )}
      {data.summaryError && (
        <div className="mt-4 px-4 py-2.5 bg-amber-50 text-amber-800 text-sm rounded-lg">{data.summaryError}</div>
      )}

      {/* KPI 카드 — 클릭 시 해당 화면으로 드릴다운 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
        {kpis.map(k => {
          const body = (
            <>
              <p className="text-xs text-gray-500">{k.label}</p>
              <p className="text-lg font-bold text-gray-900 mt-1 tabular-nums">{k.value}</p>
              {k.sub && <p className="text-xs text-gray-400 mt-0.5 tabular-nums">{k.sub}</p>}
            </>
          )
          return k.href ? (
            <Link key={k.label} href={k.href}
              className="block bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-slate-400 transition-colors">
              {body}
            </Link>
          ) : (
            <div key={k.label} className="bg-white border border-gray-200 rounded-xl px-4 py-3">{body}</div>
          )
        })}
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4 items-start">
        {/* 오늘 근태 */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">오늘 근태</h2>
            <Link href="/hr/attendance" className="text-xs text-slate-500 hover:text-slate-900">근태·휴가 화면</Link>
          </div>
          {data.attendanceReady ? (
            <div className="mt-3 text-sm text-gray-700">
              {inTime ? (
                <p>출근 <span className="font-semibold tabular-nums">{inTime}</span>
                  {outTime && <> · 퇴근 <span className="font-semibold tabular-nums">{outTime}</span></>}
                </p>
              ) : (
                <p className="text-gray-400">아직 출근 체크 전입니다. 사이드바에서 체크할 수 있습니다.</p>
              )}
            </div>
          ) : (
            <p className="mt-3 text-xs text-gray-400">근태(200) 마이그레이션 적용 후 표시됩니다.</p>
          )}
          {data.leaves.length > 0 && (
            <div className="mt-3 border-t border-gray-100 pt-2.5">
              <p className="text-xs text-gray-500 mb-1.5">최근 휴가 신청</p>
              {data.leaves.map(l => (
                <p key={l.id} className="text-xs text-gray-600 mb-1 tabular-nums">
                  {l.start_date}{l.end_date !== l.start_date ? ` ~ ${l.end_date}` : ''} · {LEAVE_TYPE_LABEL[l.leave_type] ?? l.leave_type}
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium ${
                    l.status === 'approved' ? 'bg-emerald-100 text-emerald-700'
                    : l.status === 'requested' ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-500'}`}>
                    {LEAVE_STATUS_LABEL[l.status] ?? l.status}
                  </span>
                </p>
              ))}
            </div>
          )}
        </div>

        {/* 최근 내 주문 */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">최근 내 주문</h2>
            <Link href="/orders" className="text-xs text-slate-500 hover:text-slate-900">주문 현황 전체</Link>
          </div>
          {data.recentOrders.length ? (
            <table className="w-full text-sm mt-2">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-gray-100">
                  <th className="py-1.5 pr-3 text-left font-medium">주문일</th>
                  <th className="py-1.5 pr-3 text-left font-medium">주문처</th>
                  <th className="py-1.5 pr-3 text-right font-medium">주문금액</th>
                  <th className="py-1.5 text-right font-medium">미수</th>
                </tr>
              </thead>
              <tbody>
                {data.recentOrders.map(o => (
                  <tr key={o.id} className="border-b border-gray-50">
                    <td className="py-1.5 pr-3 tabular-nums text-xs text-gray-500">{o.order_date}</td>
                    <td className="py-1.5 pr-3 font-medium">{o.customer}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{won(o.total_amount)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${o.outstanding_amount > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {won(o.outstanding_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-3 text-sm text-gray-400">내 이름으로 입력된 주문이 없습니다.</p>
          )}
        </div>
      </div>

      {/* 최근 영업일지 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">최근 영업일지</h2>
          <Link href="/me/journal" className="text-xs text-slate-500 hover:text-slate-900">전체 보기 · 작성</Link>
        </div>
        {data.recentJournal.length ? (
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-gray-500 text-xs border-b border-gray-100">
                <th className="py-1.5 pr-3 text-left font-medium">날짜</th>
                <th className="py-1.5 pr-3 text-left font-medium">유형</th>
                <th className="py-1.5 pr-3 text-left font-medium">인물 · 거래처</th>
                <th className="py-1.5 text-left font-medium">내용</th>
              </tr>
            </thead>
            <tbody>
              {data.recentJournal.map(a => (
                <tr key={a.id} className="border-b border-gray-50 align-top">
                  <td className="py-1.5 pr-3 tabular-nums text-xs text-gray-500">{a.activity_date}</td>
                  <td className="py-1.5 pr-3 text-xs">{a.activity_type}</td>
                  <td className="py-1.5 pr-3">
                    <span className="font-medium">{a.contact_name ?? '-'}</span>
                    {a.vendor_name && <span className="text-xs text-gray-400 ml-1">{a.vendor_name}</span>}
                  </td>
                  <td className="py-1.5 text-gray-600">{a.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 text-sm text-gray-400">
            아직 영업일지가 없습니다. <Link href="/me/journal" className="underline">내 영업일지</Link>에서 작성할 수 있습니다.
          </p>
        )}
      </div>
    </div>
  )
}
