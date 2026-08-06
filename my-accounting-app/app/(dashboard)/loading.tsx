// 회계·경영 모드 공통 로딩 화면 — 페이지 이동 즉시 본문 영역에 표시 (사이드바 유지)
export default function DashboardLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-slate-400">
      <div className="w-8 h-8 border-[3px] border-slate-200 border-t-slate-500 rounded-full animate-spin" />
      <p className="mt-4 text-sm">불러오는 중...</p>
    </div>
  )
}
