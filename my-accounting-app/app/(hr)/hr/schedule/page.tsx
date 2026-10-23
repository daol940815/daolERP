import PageTabs from '@/components/ui/PageTabs'
import CalendarTab from './calendar-tab'
import RulesTab from './rules-tab'

// 스케줄 — 캘린더 / 관리 탭 통합
// 캘린더는 조회 전용(ERP 원본에서 파생), 관리는 ERP에 자리가 없는 일정의 규칙을 등록한다.
export default function SchedulePage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab = searchParams.tab === 'rules' ? 'rules' : 'calendar'
  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900">스케줄</h1>
      <p className="text-sm mt-1 text-gray-500">
        휴가 · 공휴일 · 아르바이트 근무기간 · 직원 생일 · 대출 상환일은 ERP 데이터에서 그대로 따라옵니다.
        급여일 · 세무 마감 · 회사 행사 · 외근처럼 ERP에 자리가 없는 일정만 관리 탭에서 등록합니다.
      </p>
      <PageTabs className="mt-3 mb-4" active={tab} tabs={[
        { key: 'calendar', label: '캘린더', href: '/hr/schedule' },
        { key: 'rules', label: '관리', href: '/hr/schedule?tab=rules' },
      ]} />
      {tab === 'rules' ? <RulesTab /> : <CalendarTab />}
    </div>
  )
}
