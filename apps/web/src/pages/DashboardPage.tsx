import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { api } from '../api';
import { STATUS_LABEL, fmtMin } from './AttendancePage';

interface DayRow {
  dateKey: string;
  status: string;
  workMinutes: number;
  events: { eventType: string; occurredAt: string }[];
}

const kstKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

export function DashboardPage() {
  const { user } = useAuth();
  const [week, setWeek] = useState<DayRow[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!user?.employee) return;
    const now = new Date();
    const day = now.getDay(); // 0=일
    const monday = new Date(now.getTime() - ((day + 6) % 7) * 86400000);
    setWeek(await api<DayRow[]>(`/attendance/me?from=${kstKey(monday)}&to=${kstKey(now)}`));
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  async function clock(eventType: string) {
    setMessage('');
    try {
      await api('/attendance/clock', { method: 'POST', body: JSON.stringify({ eventType }) });
      setMessage('체크 완료');
      await load();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  const todayKey = kstKey(new Date());
  const today = week.find((d) => d.dateKey === todayKey);
  const weekMinutes = week.reduce((s, d) => s + d.workMinutes, 0);

  return (
    <>
      <h2>대시보드</h2>
      {user?.employee && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <button onClick={() => void clock('CLOCK_IN')}>출근</button>
            <button onClick={() => void clock('CLOCK_OUT')}>퇴근</button>
            {message && <span style={{ alignSelf: 'center', color: '#5a6274' }}>{message}</span>}
          </div>
        </div>
      )}
      <div className="cards">
        <div className="card stat">
          <div className="label">오늘 근태</div>
          <div className="value">{today ? STATUS_LABEL[today.status] ?? today.status : '—'}</div>
        </div>
        <div className="card stat">
          <div className="label">오늘 근무시간</div>
          <div className="value">{today ? fmtMin(today.workMinutes) : '—'}</div>
        </div>
        <div className="card stat">
          <div className="label">주간 근무시간</div>
          <div className="value">{fmtMin(weekMinutes)}</div>
        </div>
        <div className="card stat">
          <div className="label">잔여 연차</div>
          <div className="value">—</div>
        </div>
      </div>
      <p style={{ marginTop: 20, color: '#8a93a8' }}>
        {user?.employee?.name ?? user?.email}님, 환영합니다. 잔여 연차는 휴가 모듈(M5) 오픈 시 표시됩니다.
      </p>
    </>
  );
}
