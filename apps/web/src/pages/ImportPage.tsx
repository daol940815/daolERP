import { useState } from 'react';
import { getToken } from '../api';

interface RowResult { row: number; ok: boolean; error?: string; preview?: Record<string, unknown> }
interface ImportResult { dryRun: boolean; total: number; valid: number; invalid: number; applied: number; rows: RowResult[] }

const TARGETS = [
  { key: 'employees', label: '직원', columns: '사번 | 이름 | 입사일(YYYY-MM-DD) | 부서명 | 직급코드 | 고용형태코드' },
  { key: 'leave-grants', label: '연차 초기값', columns: '사번 | 잔여일수 | 발생일 | 사용기한(선택)' },
  { key: 'holidays', label: '휴일', columns: '일자 | 휴일명 | 유형코드(STATUTORY/COMPANY/...)' },
] as const;

/** Excel Import (기획서 4.15) — 업로드 → 검증 미리보기 → 확정 반영 2단계 */
export function ImportPage() {
  const [target, setTarget] = useState<(typeof TARGETS)[number]['key']>('employees');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState('');

  async function run(dryRun: boolean) {
    if (!file) { setMessage('파일(.xlsx)을 선택하세요.'); return; }
    setMessage('');
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/imports/${target}?dryRun=${dryRun}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: fd,
    });
    const body = await res.json();
    if (!res.ok) { setMessage(body.message ?? '실패'); return; }
    setResult(body);
    setMessage(dryRun ? '검증 완료 — 결과를 확인하고 "확정 반영"을 누르세요.' : `반영 완료: ${body.applied}건`);
  }

  const sel = TARGETS.find((t) => t.key === target)!;

  return (
    <>
      <h2>데이터 Import (Excel)</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-row">
          <select value={target} onChange={(e) => { setTarget(e.target.value as never); setResult(null); }}>
            {TARGETS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button className="secondary" onClick={() => void run(true)}>1. 검증 (미리보기)</button>
          <button onClick={() => void run(false)} disabled={!result || result.invalid === result.total}>2. 확정 반영</button>
        </div>
        <div style={{ fontSize: 12, color: '#8a93a8' }}>1행 헤더, 열 순서: {sel.columns}</div>
        {message && <div style={{ marginTop: 8 }}>{message}</div>}
      </div>

      {result && (
        <>
          <h2>결과 — 전체 {result.total} / 유효 {result.valid} / 오류 {result.invalid} / 반영 {result.applied}</h2>
          <table>
            <thead><tr><th>행</th><th>상태</th><th>내용</th></tr></thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.row}>
                  <td>{r.row}</td>
                  <td style={{ color: r.ok ? '#1a8754' : '#d43f3f' }}>{r.ok ? '유효' : '오류'}</td>
                  <td style={{ fontSize: 12 }}>{r.ok ? JSON.stringify(r.preview) : r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
