'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { kstTime, LEAVE_TYPE_LABEL, LEAVE_STATUS_LABEL, type LeaveType, type LeaveStatus } from '@/lib/attendance'
import { TodoPanel } from '@/components/layout/NotificationCenter'
import type { NotifData } from '@/lib/notifications'
import { useNotifRefresh } from '@/lib/use-notif-refresh'

// 내 대시보드 (직원 개인화면 홈)
// 본인 관련 정보만 모아 보여준다 — 이번 달 내 주문 · 미수 · 담당 거래처 ·
// 업무일지 · 오늘 근태. 숫자는 해당 화면으로 드릴다운(링크)한다.
// 영업일지는 영업팀만 쓰므로 기록이 있는 직원에게만 보인다 (2026-09-29 사용자 결정).

interface Summary {
  month: string
  orders_month: { cnt: number; total: number; outstanding: number }
  outstanding_total: { outstanding: number; cnt: number }
  consult_month: { item_cnt: number; order_cnt: number }
  vendor_cnt: number
  journal: { month_cnt: number; total_cnt: number }
}

interface OrderStat { cnt: number; total: number; outstanding: number; outstanding_cnt: number }

interface Data {
  me: { name: string | null; role: string; linked: boolean; canCustomers?: boolean; canPayments?: boolean }
  // 주문 카드 (2026-11-19, lib/my-dashboard.ts) — 내 작성 주문 · 내 담당 지점 주문
  orders: { written_month: OrderStat; written_open: OrderStat; branch_month: OrderStat; branch_vendor_cnt: number } | null
  ordersError: string | null
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
  leaveBalance: { year: number; base: number; comp: number; granted: number; used: number; remainBase: number; remainComp: number; remainTotal: number; over: number } | null
  pendingLeaves: { id: string; leave_type: LeaveType; start_date: string; end_date: string; days: number; deduct: number }[]
  leaves: { id: string; leave_type: LeaveType; start_date: string; end_date: string; status: LeaveStatus }[]
}

interface WorkRow { id: string; work_date: string; action: string; category: string | null; content: string | null }

const won = (n: number) => Math.round(n).toLocaleString('ko-KR')

export default function MyDashboardPage() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [work, setWork] = useState<{ rows: WorkRow[]; month: string } | null>(null)
  // 업무 요청 요약 (900) — 받은/보낸 카드
  const [wr, setWr] = useState<Record<string, number> | null>(null)
  // 확인할 것 패널 (알림 센터와 같은 데이터) — 영역 1개 직원은 업무 선택 화면을 보지 않으므로 홈에서
  const [notif, setNotif] = useState<NotifData | null>(null)
  const loadLive = useCallback(() => {
    fetch('/api/work-requests?summary=1').then(r => r.ok ? r.json() : null).then(j => setWr(j?.summary ?? null)).catch(() => setWr(null))
    fetch('/api/notifications', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => setNotif(j ?? null)).catch(() => setNotif(null))
  }, [])
  useEffect(() => { loadLive() }, [loadLive])
  useNotifRefresh(loadLive)   // 알림이 바뀌면 요청 카드·확인할 것 패널 자동 갱신 (⑥ 1단계)

  useEffect(() => {
    fetch('/api/me/worklog')
      .then(r => r.json())
      .then(j => setWork({ rows: Array.isArray(j.rows) ? j.rows : [], month: j.month ?? '' }))
      .catch(() => setWork({ rows: [], month: '' }))
  }, [])

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
  if (!data) return <div className="text-center py-16 text-slate-500">로딩 중...</div>

  const s = data.summary
  const o = data.orders
  // 승인 대기 휴가 중 올해 연차에서 빠질 일수 · 승인되면 남는 일수 (2026-11-19)
  const r1 = (n: number) => Math.round(n * 10) / 10
  const pendingDeduct = r1(data.pendingLeaves.reduce((a, l) => a + l.deduct, 0))
  const afterPending = data.leaveBalance ? r1(data.leaveBalance.remainTotal - data.leaveBalance.over - pendingDeduct) : 0
  const kpis = [
    ...(wr ? [
      {
        label: '받은 요청', href: '/me/requests',
        value: `미확인 ${wr.inbox_unread ?? 0}`,
        sub: `진행 중 ${wr.inbox_active ?? 0} · 지남 ${wr.inbox_overdue ?? 0}${wr.inbox_reported ? ` · 완료 확정 대기 ${wr.inbox_reported}` : ''}`,
      },
      {
        label: '보낸 요청', href: '/me/requests?tab=outbox',
        value: `진행 중 ${wr.outbox_open ?? 0}`,
        sub: `${wr.outbox_awaiting ? `완료 확정 대기 ${wr.outbox_awaiting}` : ''}${wr.outbox_awaiting && wr.outbox_rejected ? ' · ' : ''}${wr.outbox_rejected ? `반려 ${wr.outbox_rejected}` : ''}` || null,
      },
    ] : []),
    // 내 작성 주문 = 주문내역 '내 주문처리 건'과 같은 기준 (2026-11-19 사용자 결정 — 옛 이름 '내 주문')
    {
      label: '이번 달 내 작성 주문', href: `/orders?mine=handled&from=${data.month}-01&to=${data.today}`,
      value: o ? `${o.written_month.cnt}건` : '-',
      sub: o ? `${won(o.written_month.total)}원` : null,
    },
    {
      label: '내 작성 주문 미수', href: '/orders?mine=handled&from=&to=&collect=outstanding',
      value: o ? `${won(o.written_open.outstanding)}원` : '-',
      sub: o ? `미수 주문 ${o.written_open.outstanding_cnt}건` : null,
    },
    // 내 담당 지점 주문 = 매출처의 현재 지점 담당(vendor_staff)이 나 — 결제 확인 '내 담당' 필터와 같은 기준 (2026-11-19 사용자 제안)
    ...(o && o.branch_vendor_cnt > 0 ? [{
      label: '이번 달 내 담당 지점 주문', href: data.me.canPayments ? '/payments' : null,
      value: `${o.branch_month.cnt}건`,
      sub: `${won(o.branch_month.total)}원${o.branch_month.outstanding > 0 ? ` · 미수 ${won(o.branch_month.outstanding)}원` : ''}`,
    }] : []),
    {
      // 거래처 관리 권한자는 내 고객 목록으로, 없으면 내 정보 › 내 업무 요약(담당 거래처 표)으로 (2026-10-05)
      label: '담당 거래처', href: data.me.canCustomers ? '/sales-hub?mine=1' : '/me/profile?tab=work',
      value: s ? `${s.vendor_cnt}곳` : '-',
      sub: s && s.consult_month.order_cnt > 0 ? `이번 달 상담 주문 ${s.consult_month.order_cnt}건` : null,
    },
    // 올해 연차 (207 연차 관리와 같은 계산 — 부여 원장이 있는 직원만, 2026-11-19)
    ...(data.leaveBalance ? [{
      label: `${data.leaveBalance.year}년 남은 연차`, href: '/hr/attendance',
      value: data.leaveBalance.over > 0 ? `초과 ${data.leaveBalance.over}일` : `${data.leaveBalance.remainTotal}일`,
      sub: `부여 ${data.leaveBalance.granted} · 사용 ${data.leaveBalance.used}${data.leaveBalance.comp > 0 ? ` (남은 기본 ${data.leaveBalance.remainBase} · 보상 ${data.leaveBalance.remainComp})` : ''}`
        + (pendingDeduct > 0 ? ` · 승인 대기 ${pendingDeduct}일 (승인되면 ${afterPending >= 0 ? `남는 ${afterPending}일` : `초과 ${-afterPending}일`})` : ''),
    }] : []),
    {
      label: '이번 달 업무일지', href: '/me/worklog',
      value: work ? `${work.rows.length}건` : '-',
      sub: work && work.rows.length ? `최근 ${work.rows[0].work_date}` : null,
    },
    ...(s && s.journal.total_cnt > 0 ? [{
      label: '이번 달 영업일지', href: '/me/journal',
      value: `${s.journal.month_cnt}건`,
      sub: `누적 ${s.journal.total_cnt}건`,
    }] : []),
  ]
  const showJournal = (s?.journal.total_cnt ?? 0) > 0 || data.recentJournal.length > 0

  const inTime = kstTime(data.attendance?.check_in_at ?? null)
  const outTime = kstTime(data.attendance?.check_out_at ?? null)

  return (
    <div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-slate-900">대시보드</h1>
        <span className="text-sm text-slate-600">{data.me.name ?? ''} · {data.month}</span>
      </div>

      {!data.me.linked && (
        <div className="mt-4 px-4 py-2.5 bg-amber-50 text-amber-800 text-sm rounded-lg">
          직원 정보와 연결되지 않은 계정입니다. 직원·계정 관리에서 연결하면 본인 데이터가 표시됩니다.
        </div>
      )}
      {data.ordersError && (
        <div className="mt-4 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">주문 집계를 불러오지 못했습니다: {data.ordersError}</div>
      )}
      {data.summaryError && (
        <div className="mt-4 px-4 py-2.5 bg-amber-50 text-amber-800 text-sm rounded-lg">{data.summaryError}</div>
      )}

      {notif && notif.items.length > 0 && <div className="mt-4"><TodoPanel variant="light" data={notif} /></div>}

      {/* KPI 카드 — 클릭 시 해당 화면으로 드릴다운 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
        {kpis.map(k => {
          const body = (
            <>
              <p className="text-xs text-slate-600">{k.label}</p>
              <p className="text-lg font-bold text-slate-900 mt-1 tabular-nums">{k.value}</p>
              {k.sub && <p className="text-xs text-slate-500 mt-0.5 tabular-nums">{k.sub}</p>}
            </>
          )
          return k.href ? (
            <Link key={k.label} href={k.href}
              className="block bg-white border border-slate-300 rounded-xl px-4 py-3 hover:border-slate-400 transition-colors">
              {body}
            </Link>
          ) : (
            <div key={k.label} className="bg-white border border-slate-300 rounded-xl px-4 py-3">{body}</div>
          )
        })}
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4 items-start">
        {/* 오늘 근태 */}
        <div className="bg-white border border-slate-300 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">오늘 근태</h2>
            <Link href="/hr/attendance" className="text-xs text-slate-600 hover:text-slate-900">근태·휴가 화면</Link>
          </div>
          {data.attendanceReady ? (
            <div className="mt-3 text-sm text-slate-800">
              {inTime ? (
                <p>출근 <span className="font-semibold tabular-nums">{inTime}</span>
                  {outTime && <> · 퇴근 <span className="font-semibold tabular-nums">{outTime}</span></>}
                </p>
              ) : (
                <p className="text-slate-500">아직 출근 체크 전입니다. 사이드바에서 체크할 수 있습니다.</p>
              )}
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">근태(200) 마이그레이션 적용 후 표시됩니다.</p>
          )}
          {data.pendingLeaves.length > 0 && (
            <div className="mt-3 border-t border-slate-200 pt-2.5">
              <p className="text-xs text-slate-600 mb-1.5">승인 대기 휴가 {data.pendingLeaves.length}건</p>
              {data.pendingLeaves.map(l => (
                <p key={l.id} className="text-xs text-slate-700 mb-1 tabular-nums">
                  {l.start_date}{l.end_date !== l.start_date ? ` ~ ${l.end_date}` : ''} · {LEAVE_TYPE_LABEL[l.leave_type] ?? l.leave_type} {l.days}일
                  <span className="ml-1.5 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                    {LEAVE_STATUS_LABEL.requested}
                  </span>
                </p>
              ))}
            </div>
          )}
          {data.leaves.some(l => l.status !== 'requested') && (
            <div className="mt-3 border-t border-slate-200 pt-2.5">
              <p className="text-xs text-slate-600 mb-1.5">최근 휴가 신청</p>
              {data.leaves.filter(l => l.status !== 'requested').map(l => (
                <p key={l.id} className="text-xs text-slate-700 mb-1 tabular-nums">
                  {l.start_date}{l.end_date !== l.start_date ? ` ~ ${l.end_date}` : ''} · {LEAVE_TYPE_LABEL[l.leave_type] ?? l.leave_type}
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded text-xs font-medium ${
                    l.status === 'approved' ? 'bg-emerald-100 text-emerald-700'
                    : l.status === 'requested' ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-600'}`}>
                    {LEAVE_STATUS_LABEL[l.status] ?? l.status}
                  </span>
                </p>
              ))}
            </div>
          )}
        </div>

        {/* 최근 내 작성 주문 */}
        <div className="bg-white border border-slate-300 rounded-xl p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">최근 내 작성 주문</h2>
            <Link href="/orders?mine=handled" className="text-xs text-slate-600 hover:text-slate-900">주문내역 전체</Link>
          </div>
          {data.recentOrders.length ? (
            <table className="w-full text-sm mt-2">
              <thead>
                <tr className="text-slate-600 text-xs border-b border-slate-200">
                  <th className="py-1.5 pr-3 text-left font-medium">주문일</th>
                  <th className="py-1.5 pr-3 text-left font-medium">주문처</th>
                  <th className="py-1.5 pr-3 text-right font-medium">주문금액</th>
                  <th className="py-1.5 text-right font-medium">미수</th>
                </tr>
              </thead>
              <tbody>
                {data.recentOrders.map(o => (
                  <tr key={o.id} className="border-b border-slate-200">
                    <td className="py-1.5 pr-3 tabular-nums text-xs text-slate-600">{o.order_date}</td>
                    <td className="py-1.5 pr-3 font-medium">{o.customer}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{won(o.total_amount)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${o.outstanding_amount > 0 ? 'text-red-600' : 'text-slate-500'}`}>
                      {won(o.outstanding_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-3 text-sm text-slate-500">내가 작성한 주문이 없습니다.</p>
          )}
        </div>
      </div>

      {/* 최근 업무일지 — ERP에서 한 일이 자동 기록된다 */}
      <div className="bg-white border border-slate-300 rounded-xl p-4 mt-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">최근 업무일지</h2>
          <Link href="/me/worklog" className="text-xs text-slate-600 hover:text-slate-900">전체 보기</Link>
        </div>
        {work && work.rows.length ? (
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-slate-600 text-xs border-b border-slate-200">
                <th className="py-1.5 pr-3 text-left font-medium">날짜</th>
                <th className="py-1.5 pr-3 text-left font-medium">업무</th>
                <th className="py-1.5 text-left font-medium">내용</th>
              </tr>
            </thead>
            <tbody>
              {work.rows.slice(0, 5).map(w => (
                <tr key={w.id} className="border-b border-slate-200 align-top">
                  <td className="py-1.5 pr-3 tabular-nums text-xs text-slate-600">{w.work_date}</td>
                  <td className="py-1.5 pr-3 text-xs">{w.category ?? w.action}</td>
                  <td className="py-1.5 text-slate-700">{w.content ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 text-sm text-slate-500">이번 달 업무일지 기록이 없습니다. 상담일지·주문·발주를 작성하면 자동으로 기록됩니다.</p>
        )}
      </div>

      {/* 최근 영업일지 — 영업일지 기록이 있는 직원에게만 */}
      {showJournal && (
      <div className="bg-white border border-slate-300 rounded-xl p-4 mt-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">최근 영업일지</h2>
          <Link href="/me/journal" className="text-xs text-slate-600 hover:text-slate-900">전체 보기 · 작성</Link>
        </div>
        {data.recentJournal.length ? (
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-slate-600 text-xs border-b border-slate-200">
                <th className="py-1.5 pr-3 text-left font-medium">날짜</th>
                <th className="py-1.5 pr-3 text-left font-medium">유형</th>
                <th className="py-1.5 pr-3 text-left font-medium">인물 · 거래처</th>
                <th className="py-1.5 text-left font-medium">내용</th>
              </tr>
            </thead>
            <tbody>
              {data.recentJournal.map(a => (
                <tr key={a.id} className="border-b border-slate-200 align-top">
                  <td className="py-1.5 pr-3 tabular-nums text-xs text-slate-600">{a.activity_date}</td>
                  <td className="py-1.5 pr-3 text-xs">{a.activity_type}</td>
                  <td className="py-1.5 pr-3">
                    <span className="font-medium">{a.contact_name ?? '-'}</span>
                    {a.vendor_name && <span className="text-xs text-slate-500 ml-1">{a.vendor_name}</span>}
                  </td>
                  <td className="py-1.5 text-slate-700">{a.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 text-sm text-slate-500">
            아직 영업일지가 없습니다. <Link href="/me/journal" className="underline">영업일지</Link>에서 작성할 수 있습니다.
          </p>
        )}
      </div>
      )}
    </div>
  )
}
