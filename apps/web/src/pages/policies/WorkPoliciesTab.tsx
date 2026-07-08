import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';

interface Version {
  id: number;
  effectiveDate: string;
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
  standardWorkMinutes: number;
  lateGraceMinutes: number;
  ipRestricted: boolean;
  reason: string;
}
interface WorkPolicy {
  id: number;
  name: string;
  type: string;
  isActive: boolean;
  versions: Version[];
  _count: { employees: number; departments: number };
}

const TYPE_LABEL: Record<string, string> = {
  FIXED: '고정 출퇴근',
  FLEX: '시차출퇴근',
  AUTONOMOUS: '자율출퇴근',
};

export function WorkPoliciesTab() {
  const [rows, setRows] = useState<WorkPolicy[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    type: 'FIXED',
    effectiveDate: '',
    startTime: '09:00',
    endTime: '18:00',
    breakMinutes: '60',
  });
  const [verForm, setVerForm] = useState<Record<number, { effectiveDate: string; startTime: string; endTime: string; reason: string }>>({});

  const load = useCallback(async () => {
    setRows(await api<WorkPolicy[]>('/work-policies'));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/work-policies', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          version: {
            effectiveDate: form.effectiveDate,
            startTime: form.type === 'AUTONOMOUS' ? undefined : form.startTime,
            endTime: form.type === 'AUTONOMOUS' ? undefined : form.endTime,
            breakMinutes: Number(form.breakMinutes),
            reason: '정책 신규 등록',
          },
        }),
      });
      setForm({ ...form, name: '', effectiveDate: '' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addVersion(policyId: number) {
    const v = verForm[policyId];
    if (!v?.effectiveDate || !v?.reason) {
      setError('버전 추가에는 적용 시작일과 사유가 필요합니다.');
      return;
    }
    setError('');
    try {
      await api(`/work-policies/${policyId}/versions`, {
        method: 'POST',
        body: JSON.stringify({
          effectiveDate: v.effectiveDate,
          startTime: v.startTime || undefined,
          endTime: v.endTime || undefined,
          reason: v.reason,
        }),
      });
      setVerForm({ ...verForm, [policyId]: { effectiveDate: '', startTime: '', endTime: '', reason: '' } });
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
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="FIXED">고정 출퇴근</option>
              <option value="FLEX">시차출퇴근</option>
              <option value="AUTONOMOUS">자율출퇴근</option>
            </select>
            <input type="date" title="적용 시작일" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} required />
            {form.type !== 'AUTONOMOUS' && (
              <>
                <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
                <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
                <input type="number" title="휴게(분)" style={{ width: 90 }} value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })} />
              </>
            )}
            <button type="submit">근무정책 등록</button>
          </div>
          {error && <div className="error">{error}</div>}
        </form>
      </div>

      {rows.map((p) => (
        <div className="card" key={p.id} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <strong>{p.name} · {TYPE_LABEL[p.type] ?? p.type}</strong>
            <span style={{ color: '#8a93a8' }}>직원 {p._count.employees} · 부서 {p._count.departments}</span>
          </div>
          <table>
            <thead>
              <tr><th>적용 시작일</th><th>근무시간</th><th>휴게</th><th>소정근로</th><th>지각유예</th><th>사유</th></tr>
            </thead>
            <tbody>
              {p.versions.map((v) => (
                <tr key={v.id}>
                  <td>{v.effectiveDate.slice(0, 10)}</td>
                  <td>{v.startTime && v.endTime ? `${v.startTime}~${v.endTime}` : '자율'}</td>
                  <td>{v.breakMinutes}분</td>
                  <td>{Math.round(v.standardWorkMinutes / 60)}시간</td>
                  <td>{v.lateGraceMinutes}분</td>
                  <td>{v.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form-row" style={{ marginTop: 10 }}>
            <input type="date" title="새 버전 적용일" value={verForm[p.id]?.effectiveDate ?? ''} onChange={(e) => setVerForm({ ...verForm, [p.id]: { ...verForm[p.id], effectiveDate: e.target.value } as never })} />
            <input type="time" title="출근" value={verForm[p.id]?.startTime ?? ''} onChange={(e) => setVerForm({ ...verForm, [p.id]: { ...verForm[p.id], startTime: e.target.value } as never })} />
            <input type="time" title="퇴근" value={verForm[p.id]?.endTime ?? ''} onChange={(e) => setVerForm({ ...verForm, [p.id]: { ...verForm[p.id], endTime: e.target.value } as never })} />
            <input placeholder="변경 사유 (필수)" style={{ flex: 1 }} value={verForm[p.id]?.reason ?? ''} onChange={(e) => setVerForm({ ...verForm, [p.id]: { ...verForm[p.id], reason: e.target.value } as never })} />
            <button className="secondary" onClick={() => void addVersion(p.id)}>버전 추가</button>
          </div>
        </div>
      ))}
    </>
  );
}
