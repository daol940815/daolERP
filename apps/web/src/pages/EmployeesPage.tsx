import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface EmployeeRow {
  id: number;
  empNo: string;
  name: string;
  status: string;
  hireDate: string;
  department: { id: number; name: string } | null;
  jobGrade: { code: string; name: string } | null;
  employmentType: { code: string; name: string } | null;
}

interface Codes {
  jobGrades: { code: string; name: string }[];
  employmentTypes: { code: string; name: string }[];
  commonCodes: { groupCode: string; code: string; name: string }[];
}

interface DepartmentRow {
  id: number;
  name: string;
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: '재직',
  RESIGNING: '퇴사 예정',
  RESIGNED: '퇴사',
};

export function EmployeesPage() {
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [codes, setCodes] = useState<Codes | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    empNo: '',
    name: '',
    hireDate: '',
    departmentId: '',
    jobGradeCode: '',
    employmentTypeCode: '',
  });

  const load = useCallback(async (query?: string) => {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    setRows(await api<EmployeeRow[]>(`/employees${qs}`));
  }, []);

  useEffect(() => {
    void load();
    api<DepartmentRow[]>('/departments').then(setDepartments).catch(() => undefined);
    api<Codes>('/codes').then(setCodes).catch(() => undefined);
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/employees', {
        method: 'POST',
        body: JSON.stringify({
          empNo: form.empNo,
          name: form.name,
          hireDate: form.hireDate,
          departmentId: form.departmentId ? Number(form.departmentId) : undefined,
          jobGradeCode: form.jobGradeCode || undefined,
          employmentTypeCode: form.employmentTypeCode || undefined,
        }),
      });
      setForm({ empNo: '', name: '', hireDate: '', departmentId: '', jobGradeCode: '', employmentTypeCode: '' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <h2>직원 관리</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={create}>
          <div className="form-row">
            <input placeholder="사번" value={form.empNo} onChange={(e) => setForm({ ...form, empNo: e.target.value })} required />
            <input placeholder="이름" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} required />
            <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
              <option value="">부서 선택</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <select value={form.jobGradeCode} onChange={(e) => setForm({ ...form, jobGradeCode: e.target.value })}>
              <option value="">직급 선택</option>
              {codes?.jobGrades.map((g) => (
                <option key={g.code} value={g.code}>{g.name}</option>
              ))}
            </select>
            <select value={form.employmentTypeCode} onChange={(e) => setForm({ ...form, employmentTypeCode: e.target.value })}>
              <option value="">고용형태</option>
              {codes?.employmentTypes.map((t) => (
                <option key={t.code} value={t.code}>{t.name}</option>
              ))}
            </select>
            <button type="submit">직원 등록</button>
          </div>
          {error && <div className="error">{error}</div>}
        </form>
      </div>

      <div className="form-row">
        <input placeholder="이름/사번 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="secondary" onClick={() => void load(q)}>검색</button>
      </div>

      <table>
        <thead>
          <tr>
            <th>사번</th><th>이름</th><th>부서</th><th>직급</th><th>고용형태</th><th>입사일</th><th>상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.empNo}</td>
              <td>{r.name}</td>
              <td>{r.department?.name ?? '-'}</td>
              <td>{r.jobGrade?.name ?? '-'}</td>
              <td>{r.employmentType?.name ?? '-'}</td>
              <td>{r.hireDate.slice(0, 10)}</td>
              <td>{STATUS_LABEL[r.status] ?? r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
