import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';

interface Step {
  stepOrder: number;
  approverType: string;
  approverEmployee: { name: string; empNo: string } | null;
  approverJobTitleCode: string | null;
}
interface Assignment {
  employee: { name: string; empNo: string } | null;
  department: { name: string } | null;
}
interface ApprovalLine {
  id: number;
  name: string;
  requestType: string;
  isDefault: boolean;
  isActive: boolean;
  steps: Step[];
  assignments: Assignment[];
}

const REQ_LABEL: Record<string, string> = { LEAVE: '휴가', OVERTIME: '초과근무', ATTENDANCE_CORRECTION: '근태 보정' };
const APPROVER_LABEL: Record<string, string> = {
  SPECIFIC: '특정인',
  DEPT_HEAD: '직속 부서장',
  PARENT_DEPT_HEAD: '상위 부서장',
  JOB_TITLE: '특정 직책',
};

export function ApprovalLinesTab() {
  const [rows, setRows] = useState<ApprovalLine[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', requestType: 'LEAVE', approverType: 'DEPT_HEAD' });

  const load = useCallback(async () => {
    setRows(await api<ApprovalLine[]>('/approvals/lines'));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/approvals/lines', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          requestType: form.requestType,
          isDefault: false,
          steps: [{ approverType: form.approverType }],
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
            <input placeholder="라인명" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <select value={form.requestType} onChange={(e) => setForm({ ...form, requestType: e.target.value })}>
              <option value="LEAVE">휴가</option>
              <option value="OVERTIME">초과근무</option>
              <option value="ATTENDANCE_CORRECTION">근태 보정</option>
            </select>
            <select value={form.approverType} onChange={(e) => setForm({ ...form, approverType: e.target.value })}>
              <option value="DEPT_HEAD">1단계: 직속 부서장</option>
              <option value="PARENT_DEPT_HEAD">1단계: 상위 부서장</option>
            </select>
            <button type="submit">승인라인 등록</button>
          </div>
          <div style={{ color: '#8a93a8', fontSize: 13 }}>* 다단계 라인은 API로 단계 배열 지정 (M3 골격 — 화면은 1단계 등록 지원)</div>
          {error && <div className="error">{error}</div>}
        </form>
      </div>
      <table>
        <thead>
          <tr><th>라인명</th><th>유형</th><th>기본</th><th>단계</th><th>배정</th></tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td>{l.name}</td>
              <td>{REQ_LABEL[l.requestType] ?? l.requestType}</td>
              <td>{l.isDefault ? '★' : ''}</td>
              <td>{l.steps.map((s) => `${s.stepOrder}.${APPROVER_LABEL[s.approverType] ?? s.approverType}${s.approverEmployee ? `(${s.approverEmployee.name})` : ''}`).join(' → ')}</td>
              <td>{l.assignments.length === 0 ? '-' : l.assignments.map((a) => a.employee?.name ?? a.department?.name).join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
