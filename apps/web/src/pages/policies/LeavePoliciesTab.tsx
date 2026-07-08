import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';

interface LeavePolicy {
  id: number;
  name: string;
  grantBasis: string;
  expireMonths: number;
  carryOver: boolean;
  autoExpire: boolean;
  promotionDays: number[];
  minUnit: number;
  isActive: boolean;
  _count: { employees: number; departments: number };
}

export function LeavePoliciesTab() {
  const [rows, setRows] = useState<LeavePolicy[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', grantBasis: 'HIRE_DATE', expireMonths: '12', minUnit: '0.5' });

  const load = useCallback(async () => {
    setRows(await api<LeavePolicy[]>('/leave-policies'));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/leave-policies', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          grantBasis: form.grantBasis,
          fiscalStartMonth: 1,
          expireMonths: Number(form.expireMonths),
          carryOver: false,
          autoExpire: true,
          promotionDays: [60, 30],
          minUnit: Number(form.minUnit),
          isActive: true,
          reason: '연차정책 등록',
        }),
      });
      setForm({ ...form, name: '' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="card" style={{ margin: '14px 0' }}>
        <form onSubmit={create}>
          <div className="form-row">
            <input placeholder="정책명" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <select value={form.grantBasis} onChange={(e) => setForm({ ...form, grantBasis: e.target.value })}>
              <option value="HIRE_DATE">입사일 기준</option>
              <option value="FISCAL_YEAR">회계연도 기준</option>
            </select>
            <input type="number" title="사용기한(개월)" style={{ width: 110 }} value={form.expireMonths} onChange={(e) => setForm({ ...form, expireMonths: e.target.value })} />
            <select value={form.minUnit} onChange={(e) => setForm({ ...form, minUnit: e.target.value })}>
              <option value="1">1일 단위</option>
              <option value="0.5">반차(0.5)</option>
              <option value="0.25">반반차(0.25)</option>
            </select>
            <button type="submit">연차정책 등록</button>
          </div>
          {error && <div className="error">{error}</div>}
        </form>
      </div>
      <table>
        <thead>
          <tr><th>정책명</th><th>부여 기준</th><th>사용기한</th><th>이월</th><th>사용 단위</th><th>촉진</th><th>배정</th></tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.grantBasis === 'HIRE_DATE' ? '입사일' : '회계연도'}</td>
              <td>{p.expireMonths}개월</td>
              <td>{p.carryOver ? '허용' : '불가'}</td>
              <td>{p.minUnit}일</td>
              <td>{p.promotionDays.map((d) => `D-${d}`).join(', ')}</td>
              <td>직원 {p._count.employees} · 부서 {p._count.departments}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
