import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface EmployeeRow {
  id: number;
  empNo: string;
  name: string;
}
interface Schedule {
  id: number;
  date: string;
  isWorkday: boolean;
  plannedStart: string | null;
  plannedEnd: string | null;
  source: string;
  adjustReason: string | null;
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];

export function SchedulesPage() {
  const now = new Date();
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState<Schedule[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api<EmployeeRow[]>('/employees').then((e) => {
      setEmployees(e);
      // 사용자가 이미 선택했으면 덮어쓰지 않음 (fetch 지연 시 선택 클로버 방지)
      setEmployeeId((prev) => prev || (e[0] ? String(e[0].id) : ''));
    });
  }, []);

  const load = useCallback(async () => {
    if (!employeeId) return;
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;
    setRows(await api<Schedule[]>(`/work-schedules?employeeId=${employeeId}&from=${from}&to=${to}`));
  }, [employeeId, year, month]);

  useEffect(() => { void load(); }, [load]);

  async function generate() {
    setMessage('');
    try {
      const r = await api<{ created: number; updated: number; skippedManual: number }>('/work-schedules/generate', {
        method: 'POST',
        body: JSON.stringify({ employeeId: Number(employeeId), year, month, preserveManual: true }),
      });
      setMessage(`생성 ${r.created} · 갱신 ${r.updated} · MANUAL 보존 ${r.skippedManual}`);
      await load();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function adjust(s: Schedule) {
    const toWork = !s.isWorkday;
    const reason = prompt(`${s.date.slice(0, 10)} 일정 조정 사유 (필수)\n${toWork ? '휴무 → 근무로 전환' : '근무 → 휴무로 전환'}`);
    if (!reason) return;
    try {
      await api('/work-schedules/adjust', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: Number(employeeId),
          date: s.date.slice(0, 10),
          isWorkday: toWork,
          plannedStart: toWork ? s.plannedStart ?? '09:00' : undefined,
          plannedEnd: toWork ? s.plannedEnd ?? '18:00' : undefined,
          reason,
        }),
      });
      await load();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <>
      <h2>근무일정 관리</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name} ({e.empNo})</option>
            ))}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{m}월</option>
            ))}
          </select>
          <button onClick={() => void generate()}>일정 생성/재생성</button>
          {message && <span style={{ color: '#5a6274', alignSelf: 'center' }}>{message}</span>}
        </div>
      </div>

      <table>
        <thead>
          <tr><th>일자</th><th>요일</th><th>구분</th><th>예정 시간</th><th>생성</th><th>조정 사유</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const d = new Date(s.date);
            const wd = d.getUTCDay();
            return (
              <tr key={s.id} style={{ background: s.isWorkday ? undefined : '#fbfbfc', color: wd === 0 ? '#d43f3f' : wd === 6 ? '#2b5cd9' : undefined }}>
                <td>{s.date.slice(0, 10)}</td>
                <td>{WD[wd]}</td>
                <td>{s.isWorkday ? '근무' : '휴무'}</td>
                <td>{s.plannedStart && s.plannedEnd ? `${s.plannedStart}~${s.plannedEnd}` : '-'}</td>
                <td>{s.source === 'MANUAL' ? <strong>수동</strong> : '자동'}</td>
                <td>{s.adjustReason ?? ''}</td>
                <td><button className="secondary" onClick={() => void adjust(s)}>{s.isWorkday ? '휴무로' : '근무로'}</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <div className="placeholder card" style={{ marginTop: 12 }}>이 달의 일정이 없습니다. "일정 생성"을 눌러 생성하세요.</div>}
    </>
  );
}
