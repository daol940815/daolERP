// 대시보드 메인 페이지
// STEP 5에서 실제 데이터로 교체 예정 (현재는 "준비 중" 상태로 표시)

export default function DashboardPage() {
  // 오늘 날짜를 한국어 형식으로 표시
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  // STEP 5에서 실제 데이터로 교체 예정 - 요약 카드 정의
  const summaryCards = [
    {
      label: '이번달 입금',
      value: '준비 중',
      description: '당월 누적 입금액',
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      icon: '↓',
    },
    {
      label: '이번달 출금',
      value: '준비 중',
      description: '당월 누적 출금액',
      color: 'text-red-600',
      bg: 'bg-red-50',
      icon: '↑',
    },
    {
      label: '미검토 건수',
      value: '준비 중',
      description: '검토 대기 중인 거래',
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      icon: '⏳',
    },
    {
      label: '확정 건수',
      value: '준비 중',
      description: '이번달 확정 완료된 거래',
      color: 'text-green-600',
      bg: 'bg-green-50',
      icon: '✓',
    },
  ]

  return (
    <div className="max-w-5xl mx-auto">
      {/* 환영 메시지 + 오늘 날짜 */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">안녕하세요! 👋</h1>
        <p className="text-slate-500 mt-1 text-sm">{today}</p>
      </div>

      {/* 요약 카드 4개 */}
      {/* STEP 5에서 실제 데이터로 교체 예정 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm"
          >
            {/* 아이콘 + 라벨 */}
            <div className="flex items-center gap-2 mb-3">
              <span
                className={`w-8 h-8 rounded-lg ${card.bg} ${card.color}
                            flex items-center justify-center text-sm font-bold`}
              >
                {card.icon}
              </span>
              <span className="text-xs font-medium text-slate-500">
                {card.label}
              </span>
            </div>

            {/* 값 */}
            <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>

            {/* 설명 */}
            <p className="text-xs text-slate-400 mt-1">{card.description}</p>
          </div>
        ))}
      </div>

      {/* 안내 메시지 */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          다음 단계 안내
        </h3>
        <ol className="text-sm text-slate-500 space-y-1 list-decimal list-inside">
          <li>.env.local에 Supabase 키를 입력하세요</li>
          <li>Supabase에서 마이그레이션 SQL을 순서대로 실행하세요</li>
          <li>STEP 2에서 파일 업로드 기능을 구현합니다</li>
          <li>STEP 3에서 AI 자동 분류를 구현합니다</li>
          <li>STEP 5에서 이 대시보드를 실제 데이터로 교체합니다</li>
        </ol>
      </div>
    </div>
  )
}
