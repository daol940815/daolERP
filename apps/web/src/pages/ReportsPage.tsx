import { useCallback, useEffect, useState } from 'react';
import { api, getToken } from '../api';

interface SummaryRow {
  empNo: string; employeeName: string; departmentName: string | null;
  workdayCount: number; presentDays: number; absentDays: number;
  lateCount: number; lateMinutes: number; earlyLeaveCount: number;
  leaveDays: number; workMinutes: number; overtimeMinutes: number;
}
interface ExpiryRow { empNo: string; employeeName: string; grantDate: string; expireDate: string; remaining: number; daysLeft: number }

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function ReportsPage() {
  const [ym, setYm] = useState(thisMonth());
  const [source, setSource] = useState('');
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [expiry, setExpiry] = useState<ExpiryRow[]>([]);

  const load = useCallback(async () => {
    const [m, e] = await Promise.all([
      api<{ source: string; rows: SummaryRow[] }>(`/reports/monthly/${ym}`),
      api<ExpiryRow[]>('/reports/leave-expiry?withinDays=60'),
    ]);
    setSource(m.source);
    setRows(m.rows);
    setExpiry(e);
  }, [ym]);
  useEffect(() => { void load(); }, [load]);

  async function download() {
    const res = await fetch(`/api/reports/monthly/${ym}/export`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `report-${ym}.xlsx`;
    a.click();
  }

  return (
    <>
      <h2>통계/리포트</h2>
      <div className="form-row">
        <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
        <span style={{ alignSelf: 'center', color: '#5a6274' }}>
          출처: {source === 'SNAPSHOT' ? '마감 스냅샷 (확정)' : '실시간 계산'}
        </span>
        <button className="secondary" onClick={() => void download()}>Excel 다운로드</button>
      </div>
      <table style={{ marginBottom: 28 }}>
        <thead>
          <tr><th>사번</th><th>이름</th><th>부서</th><th>소정</th><th>출근</th><th>결근</th><th>지각</th><th>조퇴</th><th>휴가</th><th>근무시간</th><th>초과근무</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.empNo}>
              <td>{r.empNo}</td>
              <td>{r.employeeName}</td>
              <td>{r.departmentName ?? '-'}</td>
              <td>{r.workdayCount}</td>
              <td>{r.presentDays}</td>
              <td style={{ color: r.absentDays > 0 ? '#d43f3f' : undefined }}>{r.absentDays}</td>
              <td>{r.lateCount > 0 ? `${r.lateCount}회 ${r.lateMinutes}분` : '-'}</td>
              <td>{r.earlyLeaveCount || '-'}</td>
              <td>{r.leaveDays || '-'}</td>
              <td>{Math.floor(r.workMinutes / 60)}h {r.workMinutes % 60}m</td>
              <td>{r.overtimeMinutes > 0 ? `${Math.floor(r.overtimeMinutes / 60)}h ${r.overtimeMinutes % 60}m` : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>연차 소멸 예정자 (60일 이내 — 촉진 대상)</h2>
      <table>
        <thead>
          <tr><th>사번</th><th>이름</th><th>발생일</th><th>사용기한</th><th>잔여</th><th>남은 기간</th></tr>
        </thead>
        <tbody>
          {expiry.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: '#8a93a8' }}>소멸 예정 연차가 없습니다.</td></tr>
          )}
          {expiry.map((e, i) => (
            <tr key={i}>
              <td>{e.empNo}</td>
              <td>{e.employeeName}</td>
              <td>{e.grantDate}</td>
              <td>{e.expireDate}</td>
              <td>{e.remaining}일</td>
              <td style={{ color: e.daysLeft <= 30 ? '#d43f3f' : undefined }}>D-{e.daysLeft}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
