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
import { SchedulesPage } from './pages/SchedulesPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { AttendancePage } from './pages/AttendancePage';
import { LeavePage } from './pages/LeavePage';
import { OvertimePage } from './pages/OvertimePage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ClosingPage } from './pages/ClosingPage';
import { ReportsPage } from './pages/ReportsPage';
import { HrDashboardPage } from './pages/HrDashboardPage';
import { ImportPage } from './pages/ImportPage';
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
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/leave" element={<LeavePage />} />
        <Route path="/overtime" element={<OvertimePage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/schedules" element={<SchedulesPage />} />
        <Route path="/policies" element={<PoliciesPage />} />
        <Route path="/closing" element={<ClosingPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/hr-dashboard" element={<HrDashboardPage />} />
        <Route path="/import" element={<ImportPage />} />
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
