import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { DepartmentsPage } from './pages/DepartmentsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SchedulerPage } from './pages/SchedulerPage';
import { PoliciesPage } from './pages/PoliciesPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        {/* M2+ 에서 구현될 메뉴 — 골격만 (기획서 7장) */}
        <Route path="/attendance" element={<PlaceholderPage title="내 근태" milestone="M4" />} />
        <Route path="/leave" element={<PlaceholderPage title="휴가" milestone="M5" />} />
        <Route path="/overtime" element={<PlaceholderPage title="초과근무" milestone="M6" />} />
        <Route path="/approvals" element={<PlaceholderPage title="승인함" milestone="M3" />} />
        <Route path="/schedules" element={<PlaceholderPage title="근무일정 관리" milestone="M3" />} />
        <Route path="/policies" element={<PoliciesPage />} />
        <Route path="/closing" element={<PlaceholderPage title="근태 마감" milestone="M7" />} />
        <Route path="/reports" element={<PlaceholderPage title="통계/리포트" milestone="M7" />} />
        {/* M1 구현 완료 메뉴 */}
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/departments" element={<DepartmentsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/scheduler" element={<SchedulerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
