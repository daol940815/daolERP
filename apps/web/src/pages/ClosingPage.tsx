import { useCallback, useEffect, useState } from 'react';
import { api, getToken } from '../api';

interface Issue { level: string; type: string; empNo: string; employeeName: string; detail: string }
interface Snapshot {
  empNo: string; employeeName: string; departmentName: string | null;
  workdayCount: number; presentDays: number; absentDays: number;
  lateCount: number; lateMinutes: number; earlyLeaveCount: number;
  leaveDays: number; workMinutes: number; overtimeMinutes: number;
}
interface Closing { status: string; closedAt: string | null; snapshots: Snapshot[] }

const STATUS_LABEL: Record<string, string> = {
  OPEN: '미마감', VALIDATING: '검증 중', CLOSED: '마감', REOPENED: '마감 해제',
};

function prevMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function ClosingPage() {
  const [ym, setYm] = useState(prevMonth());
  const [closing, setClosing] = useState<Closing | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setClosing(await api<Closing | null>(`/closings/${ym}`));
  }, [ym]);
  useEffect(() => { void load(); setIssues([]); setMessage(''); }, [load]);

  async function validate() {
    setMessage('');
    setIssues(await api<Issue[]>(`/closings/${ym}/validate`));
  }

  async function close() {
    setMessage('');
    try {
      const r = await api<{ closed: boolean; snapshotCount?: number; issues: Issue[] }>(`/closings/${ym}/close`, { method: 'POST' });
      setIssues(r.issues);
      setMessage(r.closed ? `마감 완료 — 스냅샷 ${r.snapshotCount}명 확정` : '검증 실패 — BLOCKING 이슈를 해결하세요.');
      await load();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function reopen() {
    const reason = prompt('마감 해제 사유 (필수)');
    if (!reason) return;
    try {
      await api(`/closings/${ym}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) });
      setMessage('마감이 해제되었습니다. 기록 수정 후 재마감하세요.');
      await load();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function download() {
    const res = await fetch(`/api/closings/${ym}/export`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) { setMessage('내보내기 실패'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `closing-${ym}.xlsx`;
    a.click();
  }

  const status = closing?.status ?? 'OPEN';

  return (
    <>
      <h2>근태 마감</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-row" style={{ marginBottom: 6 }}>
          <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
          <span style={{ alignSelf: 'center' }}>
            상태: <strong>{STATUS_LABEL[status]}</strong>
            {closing?.closedAt && ` (${new Date(closing.closedAt).toLocaleString('ko-KR')})`}
          </span>
          <button className="secondary" onClick={() => void validate()}>검증</button>
          {status !== 'CLOSED' && <button onClick={() => void close()}>마감 실행</button>}
          {status === 'CLOSED' && (
            <>
              <button className="secondary" onClick={() => void reopen()}>마감 해제</button>
              <button onClick={() => void download()}>급여용 Excel 내보내기</button>
            </>
          )}
        </div>
        {message && <div>{message}</div>}
      </div>

      {issues.length > 0 && (
        <>
          <h2>검증 결과 ({issues.filter((i) => i.level === 'BLOCKING').length} 차단 / {issues.filter((i) => i.level === 'WARNING').length} 경고)</h2>
          <table style={{ marginBottom: 20 }}>
            <thead><tr><th>수준</th><th>유형</th><th>직원</th><th>내용</th></tr></thead>
            <tbody>
              {issues.map((i, idx) => (
                <tr key={idx}>
                  <td style={{ color: i.level === 'BLOCKING' ? '#d43f3f' : '#c07b00', fontWeight: 600 }}>
                    {i.level === 'BLOCKING' ? '차단' : '경고'}
                  </td>
                  <td>{i.type}</td>
                  <td>{i.employeeName} ({i.empNo})</td>
                  <td>{i.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {closing && closing.snapshots.length > 0 && (
        <>
          <h2>마감 스냅샷 (급여 근거 — 불변)</h2>
          <table>
            <thead>
              <tr><th>사번</th><th>이름</th><th>부서</th><th>소정</th><th>출근</th><th>결근</th><th>지각</th><th>휴가</th><th>근무시간</th><th>초과근무</th></tr>
            </thead>
            <tbody>
              {closing.snapshots.map((s) => (
                <tr key={s.empNo}>
                  <td>{s.empNo}</td>
                  <td>{s.employeeName}</td>
                  <td>{s.departmentName ?? '-'}</td>
                  <td>{s.workdayCount}</td>
                  <td>{s.presentDays}</td>
                  <td>{s.absentDays}</td>
                  <td>{s.lateCount}회 {s.lateMinutes}분</td>
                  <td>{s.leaveDays}</td>
                  <td>{Math.floor(s.workMinutes / 60)}h {s.workMinutes % 60}m</td>
                  <td>{Math.floor(s.overtimeMinutes / 60)}h {s.overtimeMinutes % 60}m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
