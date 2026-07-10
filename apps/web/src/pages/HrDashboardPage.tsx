import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

interface Dashboard {
  date: string;
  headcount: number;
  today: { present: number; late: number; notClockedIn: number; leave: number; dayoff: number };
  pendingApprovals: Record<string, number>;
  leaveExpiringCount: number;
  closingStatus: string;
}

const REQ_LABEL: Record<string, string> = {
  LEAVE: '휴가', LEAVE_CANCEL: '휴가 취소', OVERTIME: '초과근무', ATTENDANCE_CORRECTION: '근태 보정',
};
const CLOSING_LABEL: Record<string, string> = {
  OPEN: '미마감', VALIDATING: '검증 중', CLOSED: '마감 완료', REOPENED: '마감 해제됨',
};

/** 관리자 대시보드 (기획서 4.14) — 당일 인원 현황 한눈에 */
export function HrDashboardPage() {
  const [d, setD] = useState<Dashboard | null>(null);

  useEffect(() => {
    api<Dashboard>('/reports/dashboard').then(setD).catch(() => undefined);
  }, []);

  if (!d) return <h2>관리자 대시보드</h2>;
  const pendingTotal = Object.values(d.pendingApprovals).reduce((s, n) => s + n, 0);

  return (
    <>
      <h2>관리자 대시보드 — {d.date} (재직 {d.headcount}명)</h2>
      <div className="cards" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">출근</div><div className="value">{d.today.present}명</div></div>
        <div className="card stat"><div className="label">그중 지각</div><div className="value" style={{ color: d.today.late ? '#d43f3f' : undefined }}>{d.today.late}명</div></div>
        <div className="card stat"><div className="label">미출근 (예정)</div><div className="value">{d.today.notClockedIn}명</div></div>
        <div className="card stat"><div className="label">휴가</div><div className="value">{d.today.leave}명</div></div>
        <div className="card stat"><div className="label">휴무</div><div className="value">{d.today.dayoff}명</div></div>
      </div>
      <div className="cards">
        <div className="card stat">
          <div className="label"><Link to="/approvals">승인 대기</Link></div>
          <div className="value">{pendingTotal}건</div>
          <div style={{ fontSize: 12, color: '#8a93a8', marginTop: 4 }}>
            {Object.entries(d.pendingApprovals).map(([k, v]) => `${REQ_LABEL[k] ?? k} ${v}`).join(' · ') || '—'}
          </div>
        </div>
        <div className="card stat">
          <div className="label"><Link to="/reports">연차 소멸 임박 (60일)</Link></div>
          <div className="value" style={{ color: d.leaveExpiringCount ? '#c07b00' : undefined }}>{d.leaveExpiringCount}건</div>
        </div>
        <div className="card stat">
          <div className="label"><Link to="/closing">당월 마감 상태</Link></div>
          <div className="value" style={{ fontSize: 18 }}>{CLOSING_LABEL[d.closingStatus] ?? d.closingStatus}</div>
        </div>
      </div>
    </>
  );
}
