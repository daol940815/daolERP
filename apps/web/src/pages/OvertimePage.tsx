import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface OvertimeRow {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  expectedMinutes: number;
  reason: string;
  status: string;
}

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: '승인 대기',
  APPROVED: '승인',
  REJECTED: '반려',
  CANCELLED: '취소',
};

export function OvertimePage() {
  const [rows, setRows] = useState<OvertimeRow[]>([]);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ date: '', startTime: '18:00', endTime: '20:00', reason: '' });

  const load = useCallback(async () => {
    setRows(await api<OvertimeRow[]>('/overtime/requests'));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    try {
      await api('/overtime/requests', { method: 'POST', body: JSON.stringify(form) });
      setForm({ ...form, date: '', reason: '' });
      setMessage('초과근무 신청이 접수되었습니다.');
      await load();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function cancel(id: number) {
    try {
      await api(`/overtime/requests/${id}/cancel`, { method: 'POST' });
      await load();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <>
      <h2>초과근무</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={submit}>
          <div className="form-row">
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} required />
            <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} required />
            <input placeholder="사유 (필수)" style={{ flex: 1 }} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
            <button type="submit">초과근무 신청</button>
          </div>
          {message && <div style={{ marginTop: 6 }}>{message}</div>}
        </form>
      </div>
      <table>
        <thead>
          <tr><th>일자</th><th>시간</th><th>예상</th><th>사유</th><th>상태</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.date.slice(0, 10)}</td>
              <td>{r.startTime} ~ {r.endTime}</td>
              <td>{Math.floor(r.expectedMinutes / 60)}h {r.expectedMinutes % 60}m</td>
              <td>{r.reason}</td>
              <td>{STATUS_LABEL[r.status] ?? r.status}</td>
              <td>
                {r.status === 'REQUESTED' && (
                  <button className="secondary" onClick={() => void cancel(r.id)}>취소</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
