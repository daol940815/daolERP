import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

interface NotificationRow {
  id: number;
  title: string;
  body: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export function NotificationsPage() {
  const [rows, setRows] = useState<NotificationRow[]>([]);

  const load = useCallback(async () => {
    setRows(await api<NotificationRow[]>('/notifications'));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function markRead(id: number) {
    await api(`/notifications/${id}/read`, { method: 'POST' });
    await load();
  }

  async function markAllRead() {
    await api('/notifications/read-all', { method: 'POST' });
    await load();
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h2 style={{ marginBottom: 0 }}>알림함</h2>
        <button className="secondary" onClick={() => void markAllRead()}>모두 읽음</button>
      </div>
      {rows.length === 0 ? (
        <div className="placeholder card">알림이 없습니다.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((n) => (
            <div
              key={n.id}
              className="card"
              style={{ padding: 14, opacity: n.isRead ? 0.6 : 1, display: 'flex', justifyContent: 'space-between', gap: 12 }}
            >
              <div>
                <strong>{n.title}</strong>
                <div style={{ marginTop: 4 }}>{n.body}</div>
                <div style={{ fontSize: 12, color: '#8a93a8', marginTop: 4 }}>
                  {new Date(n.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                  {n.link && <> · <Link to={n.link} style={{ color: '#2b5cd9' }}>바로가기</Link></>}
                </div>
              </div>
              {!n.isRead && (
                <button className="secondary" style={{ alignSelf: 'center' }} onClick={() => void markRead(n.id)}>
                  읽음
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
