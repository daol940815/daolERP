import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';

interface Holiday {
  id: number;
  date: string;
  name: string;
  holidayType: string;
  departmentId: number | null;
}

const TYPE_LABEL: Record<string, string> = {
  STATUTORY: '법정공휴일',
  SUBSTITUTE: '대체공휴일',
  FOUNDATION: '창립기념일',
  COMPANY: '회사지정휴무',
  TEMPORARY: '임시휴무',
};

export function HolidaysTab() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [rows, setRows] = useState<Holiday[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ date: '', name: '', holidayType: 'STATUTORY' });

  const load = useCallback(async (y: number) => {
    setRows(await api<Holiday[]>(`/holidays?year=${y}`));
  }, []);
  useEffect(() => { void load(year); }, [load, year]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/holidays', {
        method: 'POST',
        body: JSON.stringify({ date: form.date, name: form.name, holidayType: form.holidayType }),
      });
      setForm({ ...form, date: '', name: '' });
      await load(year);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: number) {
    const reason = prompt('삭제 사유를 입력하세요 (필수)');
    if (!reason) return;
    try {
      await api(`/holidays/${id}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
      await load(year);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="card" style={{ margin: '14px 0' }}>
        <form onSubmit={create}>
          <div className="form-row">
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            <input placeholder="휴일명" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <select value={form.holidayType} onChange={(e) => setForm({ ...form, holidayType: e.target.value })}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button type="submit">휴일 등록</button>
          </div>
          {error && <div className="error">{error}</div>}
        </form>
      </div>
      <div className="form-row">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
      </div>
      <table>
        <thead>
          <tr><th>일자</th><th>휴일명</th><th>유형</th><th>범위</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.id}>
              <td>{h.date.slice(0, 10)}</td>
              <td>{h.name}</td>
              <td>{TYPE_LABEL[h.holidayType] ?? h.holidayType}</td>
              <td>{h.departmentId ? `부서 ${h.departmentId}` : '전사'}</td>
              <td><button className="secondary" onClick={() => void remove(h.id)}>삭제</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
