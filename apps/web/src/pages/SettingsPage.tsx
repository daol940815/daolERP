import { useEffect, useState } from 'react';
import { api } from '../api';

interface SettingRow {
  key: string;
  value: unknown;
}

/** 시스템 설정 (기획서 4.13) — 법인 복제 시 변경 지점 */
export function SettingsPage() {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    api<SettingRow[]>('/settings').then(setRows).catch(() => undefined);
  }, []);

  async function save() {
    setMessage('');
    const values: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(edits)) {
      const original = rows.find((r) => r.key === key)?.value;
      // 원본 타입 유지 (숫자/배열은 JSON 파싱 시도)
      if (typeof original === 'number') values[key] = Number(raw);
      else if (Array.isArray(original)) {
        try { values[key] = JSON.parse(raw); } catch { values[key] = raw.split(',').map((s) => s.trim()).filter(Boolean); }
      } else values[key] = raw;
    }
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify({ values, reason }) });
      setRows(await api<SettingRow[]>('/settings'));
      setEdits({});
      setReason('');
      setMessage('저장되었습니다.');
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <>
      <h2>시스템 설정</h2>
      <div className="card">
        <table>
          <thead>
            <tr><th style={{ width: 280 }}>키</th><th>값</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.key}</td>
                <td>
                  <input
                    style={{ width: '100%' }}
                    value={edits[r.key] ?? (typeof r.value === 'string' ? r.value : JSON.stringify(r.value))}
                    onChange={(e) => setEdits({ ...edits, [r.key]: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="form-row" style={{ marginTop: 14 }}>
          <input
            placeholder="변경 사유 (필수)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ flex: 1 }}
          />
          <button onClick={() => void save()} disabled={!reason || Object.keys(edits).length === 0}>
            저장
          </button>
        </div>
        {message && <div style={{ marginTop: 8 }}>{message}</div>}
      </div>
    </>
  );
}
