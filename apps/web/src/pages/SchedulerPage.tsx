import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface JobRow {
  id: number;
  name: string;
  description: string | null;
  cron: string;
  isActive: boolean;
  runs: { status: string; startedAt: string; finishedAt: string | null; error: string | null }[];
}

export function SchedulerPage() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setJobs(await api<JobRow[]>('/scheduler/jobs'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(id: number) {
    setMessage('');
    try {
      await api(`/scheduler/jobs/${id}/run`, { method: 'POST' });
      await load();
      setMessage('실행 요청 완료 — 실행 이력에서 결과를 확인하세요.');
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <>
      <h2>스케줄러</h2>
      {message && <div style={{ marginBottom: 10 }}>{message}</div>}
      <table>
        <thead>
          <tr><th>작업</th><th>설명</th><th>주기</th><th>활성</th><th>최근 실행</th><th></th></tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>{j.name}</td>
              <td>{j.description ?? '-'}</td>
              <td><code>{j.cron}</code></td>
              <td>{j.isActive ? '활성' : '비활성'}</td>
              <td>
                {j.runs[0]
                  ? `${j.runs[0].status} (${j.runs[0].startedAt.slice(0, 16).replace('T', ' ')})`
                  : '-'}
              </td>
              <td>
                <button className="secondary" onClick={() => void run(j.id)}>수동 실행</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
