'use client'

import { useMemo } from 'react'
import MainLayout from '@/components/layout/MainLayout'
import StatsCard from '@/components/features/dashboard/StatsCard'
import { useDashboardStats, useMonthlyData, useInstitutionSummary } from '@/hooks/useDashboard'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  TrendingUp, TrendingDown, ArrowUpDown, Building2, CreditCard, Upload,
} from 'lucide-react'

function formatKRW(v: number) {
  if (v >= 1_0000_0000) return `${(v / 1_0000_0000).toFixed(1)}억`
  if (v >= 10000) return `${(v / 10000).toFixed(0)}만`
  return v.toLocaleString('ko-KR')
}

const MONTH_NAMES = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

export default function DashboardPage() {
  const { data: stats } = useDashboardStats()
  const { data: monthly = [] } = useMonthlyData()
  const { data: byInst = [] } = useInstitutionSummary()

  const chartData = useMemo(() =>
    monthly.map(m => ({
      name: MONTH_NAMES[m.month - 1],
      입금: m.deposit,
      출금: m.withdrawal,
    })),
    [monthly]
  )

  return (
    <MainLayout>
      <div className="space-y-4">
        <h1 className="text-base font-semibold text-slate-200">대시보드</h1>

        {/* 통계 카드 */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <StatsCard
            title="총 거래건수"
            value={(stats?.total_transactions ?? 0).toLocaleString()}
            icon={ArrowUpDown}
            color="blue"
            className="xl:col-span-1"
          />
          <StatsCard
            title="총 입금"
            value={`${formatKRW(stats?.total_deposit ?? 0)}원`}
            icon={TrendingUp}
            color="green"
          />
          <StatsCard
            title="총 출금"
            value={`${formatKRW(stats?.total_withdrawal ?? 0)}원`}
            icon={TrendingDown}
            color="red"
          />
          <StatsCard
            title="순수지"
            value={`${formatKRW(Math.abs(stats?.net_amount ?? 0))}원`}
            subtitle={(stats?.net_amount ?? 0) >= 0 ? '흑자' : '적자'}
            icon={TrendingUp}
            color={(stats?.net_amount ?? 0) >= 0 ? 'green' : 'red'}
          />
          <StatsCard
            title="금융기관"
            value={`${stats?.institution_count ?? 0}개`}
            icon={Building2}
            color="purple"
          />
          <StatsCard
            title="최근 업로드"
            value={`${stats?.recent_upload_count ?? 0}건`}
            subtitle="최근 7일"
            icon={Upload}
            color="yellow"
          />
        </div>

        {/* 월별 차트 */}
        <div className="erp-card p-4">
          <h2 className="text-sm font-medium text-slate-300 mb-4">월별 입출금 현황</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} barSize={16}>
              <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={v => formatKRW(v)} />
              <Tooltip
                contentStyle={{ background: '#1e2433', border: '1px solid #2e3a4e', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#e2e8f0' }}
                formatter={(v: number) => [`${v.toLocaleString()}원`]}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
              <Bar dataKey="입금" fill="#10b981" radius={[3, 3, 0, 0]} />
              <Bar dataKey="출금" fill="#ef4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 기관별 현황 */}
        {byInst.length > 0 && (
          <div className="erp-card p-4">
            <h2 className="text-sm font-medium text-slate-300 mb-3">기관별 거래 현황</h2>
            <table className="erp-table">
              <thead>
                <tr>
                  <th>기관명</th>
                  <th>구분</th>
                  <th className="text-right">거래건수</th>
                  <th className="text-right">입금합계</th>
                  <th className="text-right">출금합계</th>
                </tr>
              </thead>
              <tbody>
                {byInst.map(inst => (
                  <tr key={inst.name}>
                    <td className="text-slate-200">{inst.name}</td>
                    <td>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        inst.type === 'bank' ? 'bg-blue-500/15 text-blue-400' : 'bg-violet-500/15 text-violet-400'
                      }`}>
                        {inst.type === 'bank' ? '은행' : '카드'}
                      </span>
                    </td>
                    <td className="text-right text-slate-300">{inst.count.toLocaleString()}</td>
                    <td className="text-right text-emerald-400">{inst.deposit.toLocaleString()}원</td>
                    <td className="text-right text-red-400">{inst.withdrawal.toLocaleString()}원</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </MainLayout>
  )
}
