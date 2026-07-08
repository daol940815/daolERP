import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

interface Balance {
  summary: { granted: number; used: number; expired: number; remaining: number; pending: number; available: number };
  grants: { id: number; grantDate: string; expireDate: string; days: number; used: number; remaining: number; status: string; reason: string }[];
}
interface LeaveTypeRow { code: string; name: string; allowHalfDay: boolean; attachmentRule: string }
interface RequestRow {
  id: number; startDate: string; endDate: string; halfDay: boolean; days: number;
  reason: string; status: string; leaveType: { code: string; name: string };
}
interface CalendarRow {
  id: number; startDate: string; endDate: string; days: number; status: string;
  employee: { id: number; name: string }; leaveType: { name: string };
}

const REQ_LABEL: Record<string, string> = {
  REQUESTED: '승인 대기', APPROVED: '승인', REJECTED: '반려', CANCELLED: '취소', CANCEL_REQUESTED: '취소 신청 중',
};
const GRANT_LABEL: Record<string, string> = { ACTIVE: '유효', EXHAUSTED: '소진', EXPIRED: '만료' };

export function LeavePage() {
  const { user } = useAuth();
  const now = new Date();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [types, setTypes] = useState<LeaveTypeRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [calendar, setCalendar] = useState<CalendarRow[]>([]);
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ leaveTypeCode: 'ANNUAL', startDate: '', endDate: '', halfDay: false, reason: '' });
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    const [b, r, c] = await Promise.all([
      api<Balance>('/leaves/balance'),
      api<RequestRow[]>('/leaves/requests'),
      api<CalendarRow[]>(`/leaves/calendar?year=${now.getFullYear()}&month=${calMonth}`).catch(() => []),
    ]);
    setBalance(b);
    setRequests(r);
    setCalendar(c);
  }, [calMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api<LeaveTypeRow[]>('/leave-types').catch(() => [
      { code: 'ANNUAL', name: '연차', allowHalfDay: true, attachmentRule: 'NONE' },
    ]).then((t) => setTypes(t as LeaveTypeRow[]));
    void load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    try {
      let attachmentIds: number[] | undefined;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/attachments', {
          method: 'POST',
          headers: { Authorization: `Bearer ${localStorage.getItem('daolerp.token')}` },
          body: fd,
        });
        if (!res.ok) throw new Error('첨부 업로드 실패');
        attachmentIds = [(await res.json()).id];
      }
      await api('/leaves/requests', {
        method: 'POST',
        body: JSON.stringify({
          leaveTypeCode: form.leaveTypeCode,
          startDate: form.startDate,
          endDate: form.halfDay ? form.startDate : form.endDate,
          halfDay: form.halfDay,
          reason: form.reason,
          attachmentIds,
        }),
      });
      setForm({ ...form, startDate: '', endDate: '', reason: '', halfDay: false });
      setFile(null);
      setMessage('휴가 신청이 접수되었습니다.');
      await load();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function cancel(id: number) {
    setMessage('');
    try {
      await api(`/leaves/requests/${id}/cancel`, { method: 'POST' });
      await load();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  const s = balance?.summary;
  const selType = types.find((t) => t.code === form.leaveTypeCode);

  return (
    <>
      <h2>휴가</h2>
      <div className="cards" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">가용 연차</div><div className="value">{s?.available ?? '—'}일</div></div>
        <div className="card stat"><div className="label">잔여 (승인 대기 {s?.pending ?? 0}일 포함 전)</div><div className="value">{s?.remaining ?? '—'}일</div></div>
        <div className="card stat"><div className="label">사용</div><div className="value">{s?.used ?? '—'}일</div></div>
        <div className="card stat"><div className="label">소멸</div><div className="value">{s?.expired ?? '—'}일</div></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={submit}>
          <div className="form-row">
            <select value={form.leaveTypeCode} onChange={(e) => setForm({ ...form, leaveTypeCode: e.target.value })}>
              {types.filter((t) => (t as { isActive?: boolean }).isActive !== false).map((t) => (
                <option key={t.code} value={t.code}>{t.name}</option>
              ))}
            </select>
            <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
            {!form.halfDay && (
              <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
            )}
            {selType?.allowHalfDay && (
              <label style={{ alignSelf: 'center', display: 'flex', gap: 4 }}>
                <input type="checkbox" checked={form.halfDay} onChange={(e) => setForm({ ...form, halfDay: e.target.checked })} />
                반차
              </label>
            )}
            <input placeholder="사유 (필수)" style={{ flex: 1 }} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
            {selType?.attachmentRule !== 'NONE' && (
              <input type="file" title={selType?.attachmentRule === 'REQUIRED' ? '증빙 필수' : '증빙 선택'} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            )}
            <button type="submit">휴가 신청</button>
          </div>
          {selType?.attachmentRule === 'REQUIRED' && (
            <div style={{ fontSize: 12, color: '#d43f3f' }}>* {selType.name}은(는) 증빙 첨부가 필수입니다.</div>
          )}
          {message && <div style={{ marginTop: 6 }}>{message}</div>}
        </form>
      </div>

      <h2>신청 내역</h2>
      <table style={{ marginBottom: 24 }}>
        <thead>
          <tr><th>유형</th><th>기간</th><th>일수</th><th>사유</th><th>상태</th><th></th></tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}>
              <td>{r.leaveType.name}{r.halfDay ? ' (반차)' : ''}</td>
              <td>{r.startDate.slice(0, 10)} ~ {r.endDate.slice(0, 10)}</td>
              <td>{r.days}</td>
              <td>{r.reason}</td>
              <td>{REQ_LABEL[r.status] ?? r.status}</td>
              <td>
                {['REQUESTED', 'APPROVED'].includes(r.status) && (
                  <button className="secondary" onClick={() => void cancel(r.id)}>취소</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>연차 발생 내역</h2>
      <table style={{ marginBottom: 24 }}>
        <thead>
          <tr><th>발생일</th><th>일수</th><th>사용</th><th>잔여</th><th>사용기한</th><th>상태</th><th>발생 사유</th></tr>
        </thead>
        <tbody>
          {balance?.grants.map((g) => (
            <tr key={g.id} style={{ color: g.status === 'EXPIRED' ? '#8a93a8' : undefined }}>
              <td>{g.grantDate}</td>
              <td>{g.days}</td>
              <td>{g.used}</td>
              <td>{g.remaining}</td>
              <td>{g.expireDate}</td>
              <td>{GRANT_LABEL[g.status] ?? g.status}</td>
              <td style={{ fontSize: 12 }}>{g.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>부서 휴가 캘린더 — {user?.employee?.departmentName ?? ''}</h2>
      <div className="form-row">
        <select value={calMonth} onChange={(e) => setCalMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
      </div>
      <table>
        <thead>
          <tr><th>직원</th><th>유형</th><th>기간</th><th>일수</th><th>상태</th></tr>
        </thead>
        <tbody>
          {calendar.length === 0 && (
            <tr><td colSpan={5} style={{ color: '#8a93a8', textAlign: 'center' }}>이 달의 부서 휴가가 없습니다.</td></tr>
          )}
          {calendar.map((c) => (
            <tr key={c.id}>
              <td>{c.employee.name}</td>
              <td>{c.leaveType.name}</td>
              <td>{c.startDate.slice(0, 10)} ~ {c.endDate.slice(0, 10)}</td>
              <td>{c.days}</td>
              <td>{REQ_LABEL[c.status] ?? c.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
