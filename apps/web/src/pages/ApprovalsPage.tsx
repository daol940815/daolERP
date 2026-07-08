import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface InboxItem {
  id: number;
  stepOrder: number;
  approval: {
    id: number;
    requestType: string;
    requestId: number;
    currentStep: number;
    applicant: { name: string; empNo: string };
  };
}

const REQUEST_LABEL: Record<string, string> = {
  LEAVE: '휴가',
  OVERTIME: '초과근무',
  ATTENDANCE_CORRECTION: '근태 보정',
};

/** 승인함 (기획서 APV-05) — 내 차례인 대기 건 처리 */
export function ApprovalsPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setItems(await api<InboxItem[]>('/approvals/inbox'));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function decide(approvalId: number, action: 'approve' | 'reject') {
    const comment = prompt(action === 'approve' ? '승인 의견 (선택)' : '반려 사유');
    if (action === 'reject' && !comment) return;
    setMessage('');
    try {
      await api(`/approvals/${approvalId}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ comment: comment ?? undefined }),
      });
      await load();
      setMessage(action === 'approve' ? '승인 처리했습니다.' : '반려 처리했습니다.');
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <>
      <h2>승인함</h2>
      {message && <div style={{ marginBottom: 10 }}>{message}</div>}
      {items.length === 0 ? (
        <div className="placeholder card">대기 중인 승인 건이 없습니다.</div>
      ) : (
        <table>
          <thead>
            <tr><th>유형</th><th>신청자</th><th>신청 ID</th><th>현재 단계</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{REQUEST_LABEL[it.approval.requestType] ?? it.approval.requestType}</td>
                <td>{it.approval.applicant.name} ({it.approval.applicant.empNo})</td>
                <td>#{it.approval.requestId}</td>
                <td>{it.approval.currentStep}단계</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => void decide(it.approval.id, 'approve')}>승인</button>
                  <button className="secondary" onClick={() => void decide(it.approval.id, 'reject')}>반려</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
