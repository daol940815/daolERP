import { useState } from 'react';
import { WorkPoliciesTab } from './policies/WorkPoliciesTab';
import { LeavePoliciesTab } from './policies/LeavePoliciesTab';
import { LeaveTypesTab } from './policies/LeaveTypesTab';
import { HolidaysTab } from './policies/HolidaysTab';

const TABS = [
  { key: 'work', label: '근무정책' },
  { key: 'leave', label: '연차정책' },
  { key: 'types', label: '휴가유형' },
  { key: 'holidays', label: '휴일' },
] as const;

export function PoliciesPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('work');

  return (
    <>
      <h2>정책 관리</h2>
      <div className="form-row" style={{ gap: 6 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? '' : 'secondary'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'work' && <WorkPoliciesTab />}
      {tab === 'leave' && <LeavePoliciesTab />}
      {tab === 'types' && <LeaveTypesTab />}
      {tab === 'holidays' && <HolidaysTab />}
    </>
  );
}
