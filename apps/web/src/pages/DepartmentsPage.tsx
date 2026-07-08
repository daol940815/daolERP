import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface DepartmentRow {
  id: number;
  name: string;
  parentId: number | null;
  isActive: boolean;
  headEmployee: { id: number; name: string; empNo: string } | null;
  _count: { employees: number };
}

export function DepartmentsPage() {
  const [rows, setRows] = useState<DepartmentRow[]>([]);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setRows(await api<DepartmentRow[]>('/departments'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/departments', {
        method: 'POST',
        body: JSON.stringify({ name, parentId: parentId ? Number(parentId) : undefined }),
      });
      setName('');
      setParentId('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <h2>부서 관리</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={create}>
          <div className="form-row">
            <input placeholder="부서명" value={name} onChange={(e) => setName(e.target.value)} required />
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">상위 부서 없음</option>
              {rows.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <button type="submit">부서 등록</button>
          </div>
          {error && <div className="error">{error}</div>}
        </form>
      </div>
      <table>
        <thead>
          <tr><th>ID</th><th>부서명</th><th>상위 부서</th><th>부서장</th><th>인원</th><th>상태</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{r.name}</td>
              <td>{rows.find((p) => p.id === r.parentId)?.name ?? '-'}</td>
              <td>{r.headEmployee ? `${r.headEmployee.name} (${r.headEmployee.empNo})` : '-'}</td>
              <td>{r._count.employees}</td>
              <td>{r.isActive ? '사용' : '비활성'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
