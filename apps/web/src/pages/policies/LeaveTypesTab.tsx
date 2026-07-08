import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';

interface LeaveType {
  id: number;
  code: string;
  name: string;
  paidType: string;
  deductsAnnual: boolean;
  attachmentRule: string;
  allowHalfDay: boolean;
  isActive: boolean;
}

const PAID_LABEL: Record<string, string> = { PAID: '유급', UNPAID: '무급', POLICY: '정책' };
const ATT_LABEL: Record<string, string> = { NONE: '없음', OPTIONAL: '선택', REQUIRED: '필수' };

export function LeaveTypesTab() {
  const [rows, setRows] = useState<LeaveType[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ code: '', name: '', paidType: 'PAID', attachmentRule: 'NONE' });

  const load = useCallback(async () => {
    setRows(await api<LeaveType[]>('/leave-types'));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/leave-types', {
        method: 'POST',
        body: JSON.stringify({
          code: form.code,
          name: form.name,
          paidType: form.paidType,
          deductsAnnual: false,
          attachmentRule: form.attachmentRule,
          allowHalfDay: false,
          isActive: true,
        }),
      });
      setForm({ ...form, code: '', name: '' });
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
            <input placeholder="코드 (예: REFRESH)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required />
            <input placeholder="유형명" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <select value={form.paidType} onChange={(e) => setForm({ ...form, paidType: e.target.value })}>
              <option value="PAID">유급</option>
              <option value="UNPAID">무급</option>
              <option value="POLICY">정책</option>
            </select>
            <select value={form.attachmentRule} onChange={(e) => setForm({ ...form, attachmentRule: e.target.value })}>
              <option value="NONE">첨부 없음</option>
              <option value="OPTIONAL">첨부 선택</option>
              <option value="REQUIRED">첨부 필수</option>
            </select>
            <button type="submit">휴가 유형 등록</button>
          </div>
          {error && <div className="error">{error}</div>}
        </form>
      </div>
      <table>
        <thead>
          <tr><th>코드</th><th>유형명</th><th>유급</th><th>연차 차감</th><th>첨부</th><th>반차</th><th>상태</th></tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td><code>{t.code}</code></td>
              <td>{t.name}</td>
              <td>{PAID_LABEL[t.paidType]}</td>
              <td>{t.deductsAnnual ? '예' : '-'}</td>
              <td>{ATT_LABEL[t.attachmentRule]}</td>
              <td>{t.allowHalfDay ? '가능' : '-'}</td>
              <td>{t.isActive ? '사용' : '비활성'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
