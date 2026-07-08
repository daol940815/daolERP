import { useAuth } from '../auth';

/** M1 골격 — 실제 위젯(오늘 근태, 잔여 연차 등)은 해당 모듈 구현 시 연결 (기획서 4.14) */
export function DashboardPage() {
  const { user } = useAuth();

  return (
    <>
      <h2>대시보드</h2>
      <div className="cards">
        <div className="card stat">
          <div className="label">오늘 근태</div>
          <div className="value">—</div>
        </div>
        <div className="card stat">
          <div className="label">주간 근무시간</div>
          <div className="value">—</div>
        </div>
        <div className="card stat">
          <div className="label">잔여 연차</div>
          <div className="value">—</div>
        </div>
        <div className="card stat">
          <div className="label">대기 중 신청</div>
          <div className="value">—</div>
        </div>
      </div>
      <p style={{ marginTop: 20, color: '#8a93a8' }}>
        {user?.employee?.name ?? user?.email}님, 환영합니다. 출퇴근 체크(M4)·휴가(M5) 기능이 순차
        오픈됩니다.
      </p>
    </>
  );
}
