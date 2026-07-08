import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface EventRow {
  id: number;
  eventType: string;
  occurredAt: string;
  isCorrection: boolean;
}
interface DayRow {
  dateKey: string;
  status: string;
  workMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  anomalies: string[];
  events: EventRow[];
}
interface Correction {
  id: number;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  reason: string;
  status: string;
}

export const STATUS_LABEL: Record<string, string> = {
  NORMAL: '정상',
  LATE: '지각',
  EARLY_LEAVE: '조퇴',
  LATE_EARLY: '지각+조퇴',
  ABSENT: '결근',
  INCOMPLETE: '기록 불완전',
  WORKING: '근무 중',
  SCHEDULED: '예정',
  DAYOFF: '휴무',
  LEAVE: '휴가',
  NO_SCHEDULE: '일정 없음',
};
const EVENT_LABEL: Record<string, string> = {
  CLOCK_IN: '출근',
  CLOCK_OUT: '퇴근',
  OUTING_START: '외출',
  OUTING_END: '복귀',
};
const CORR_LABEL: Record<string, string> = {
  REQUESTED: '승인 대기',
  APPROVED: '승인됨(반영 중)',
  APPLIED: '반영 완료',
  REJECTED: '반려',
  CANCELLED: '취소',
};
export const fmtMin = (m: number) => (m > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : '-');
const kstTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });

export function AttendancePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [days, setDays] = useState<DayRow[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [message, setMessage] = useState('');
  const [corrForm, setCorrForm] = useState({ date: '', clockIn: '', clockOut: '', reason: '' });
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;
    const [d, c] = await Promise.all([
      api<DayRow[]>(`/attendance/me?from=${from}&to=${to}`),
      api<Correction[]>('/attendance/corrections'),
    ]);
    setDays(d);
    setCorrections(c);
  }, [year, month]);

  useEffect(() => { void load(); }, [load]);

  async function clock(eventType: string) {
    setMessage('');
    try {
      await api('/attendance/clock', { method: 'POST', body: JSON.stringify({ eventType }) });
      setMessage(`${EVENT_LABEL[eventType]} 체크 완료 (${new Date().toLocaleTimeString('ko-KR')})`);
      await load();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function requestCorrection(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    try {
      let attachmentIds: number[] | undefined;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        // multipart 는 공용 api() 대신 직접 fetch
        const res = await fetch('/api/attachments', {
          method: 'POST',
          headers: { Authorization: `Bearer ${localStorage.getItem('daolerp.token')}` },
          body: fd,
        });
        if (!res.ok) throw new Error('첨부 업로드 실패');
        attachmentIds = [(await res.json()).id];
      }
      await api('/attendance/corrections', {
        method: 'POST',
        body: JSON.stringify({
          date: corrForm.date,
          clockIn: corrForm.clockIn || undefined,
          clockOut: corrForm.clockOut || undefined,
          reason: corrForm.reason,
          attachmentIds,
        }),
      });
      setCorrForm({ date: '', clockIn: '', clockOut: '', reason: '' });
      setFile(null);
      setMessage('보정 신청이 접수되었습니다.');
      await load();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const today = days.find((d) => d.dateKey === todayKey);

  return (
    <>
      <h2>내 근태</h2>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-row" style={{ marginBottom: 8 }}>
          <button onClick={() => void clock('CLOCK_IN')}>출근</button>
          <button onClick={() => void clock('CLOCK_OUT')}>퇴근</button>
          <button className="secondary" onClick={() => void clock('OUTING_START')}>외출</button>
          <button className="secondary" onClick={() => void clock('OUTING_END')}>복귀</button>
          {message && <span style={{ alignSelf: 'center', color: '#5a6274' }}>{message}</span>}
        </div>
        {today && (
          <div style={{ color: '#5a6274', fontSize: 13 }}>
            오늘({todayKey}): {STATUS_LABEL[today.status]} · 근무 {fmtMin(today.workMinutes)} ·{' '}
            {today.events.map((e) => `${EVENT_LABEL[e.eventType]} ${kstTime(e.occurredAt)}${e.isCorrection ? '(보정)' : ''}`).join(' → ') || '기록 없음'}
          </div>
        )}
      </div>

      <div className="form-row">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[now.getFullYear() - 1, now.getFullYear()].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
      </div>

      <table>
        <thead>
          <tr><th>일자</th><th>판정</th><th>근무시간</th><th>지각</th><th>조퇴</th><th>기록</th><th>이상</th></tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.dateKey} style={{ background: ['DAYOFF', 'NO_SCHEDULE'].includes(d.status) ? '#fbfbfc' : undefined }}>
              <td>{d.dateKey}</td>
              <td style={{ color: ['LATE', 'EARLY_LEAVE', 'LATE_EARLY', 'ABSENT', 'INCOMPLETE'].includes(d.status) ? '#d43f3f' : undefined }}>
                {STATUS_LABEL[d.status] ?? d.status}
              </td>
              <td>{fmtMin(d.workMinutes)}</td>
              <td>{d.lateMinutes > 0 ? `${d.lateMinutes}분` : '-'}</td>
              <td>{d.earlyLeaveMinutes > 0 ? `${d.earlyLeaveMinutes}분` : '-'}</td>
              <td style={{ fontSize: 12 }}>
                {d.events.map((e) => `${EVENT_LABEL[e.eventType]} ${kstTime(e.occurredAt)}${e.isCorrection ? '(보정)' : ''}`).join(', ')}
              </td>
              <td style={{ fontSize: 12, color: '#d43f3f' }}>{d.anomalies.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: 28 }}>근태 보정 신청</h2>
      <div className="card" style={{ marginBottom: 14 }}>
        <form onSubmit={requestCorrection}>
          <div className="form-row">
            <input type="date" value={corrForm.date} onChange={(e) => setCorrForm({ ...corrForm, date: e.target.value })} required />
            <input type="time" title="보정 출근" value={corrForm.clockIn} onChange={(e) => setCorrForm({ ...corrForm, clockIn: e.target.value })} />
            <input type="time" title="보정 퇴근" value={corrForm.clockOut} onChange={(e) => setCorrForm({ ...corrForm, clockOut: e.target.value })} />
            <input placeholder="사유 (필수)" style={{ flex: 1 }} value={corrForm.reason} onChange={(e) => setCorrForm({ ...corrForm, reason: e.target.value })} required />
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button type="submit">보정 신청</button>
          </div>
        </form>
      </div>
      <table>
        <thead>
          <tr><th>대상 일자</th><th>보정 출근</th><th>보정 퇴근</th><th>사유</th><th>상태</th><th></th></tr>
        </thead>
        <tbody>
          {corrections.map((c) => (
            <tr key={c.id}>
              <td>{c.date.slice(0, 10)}</td>
              <td>{c.clockIn ?? '-'}</td>
              <td>{c.clockOut ?? '-'}</td>
              <td>{c.reason}</td>
              <td>{CORR_LABEL[c.status] ?? c.status}</td>
              <td>
                {c.status === 'REQUESTED' && (
                  <button className="secondary" onClick={() => void api(`/attendance/corrections/${c.id}/cancel`, { method: 'POST' }).then(load)}>
                    취소
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
