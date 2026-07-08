import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './auth';

/** 기획서 7장 화면 구성 — 권한에 따라 메뉴 노출 */
export function Layout() {
  const { user, logout, hasPermission } = useAuth();

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">daolERP 근태관리</div>
        <NavLink to="/" end>대시보드</NavLink>
        <div className="group">근태</div>
        <NavLink to="/attendance">내 근태</NavLink>
        <NavLink to="/leave">휴가</NavLink>
        <NavLink to="/overtime">초과근무</NavLink>
        <NavLink to="/approvals">승인함</NavLink>
        {hasPermission('employee.manage') && (
          <>
            <div className="group">HR</div>
            <NavLink to="/employees">직원 관리</NavLink>
            <NavLink to="/departments">부서 관리</NavLink>
            <NavLink to="/schedules">근무일정 관리</NavLink>
            <NavLink to="/policies">정책 관리</NavLink>
            <NavLink to="/closing">근태 마감</NavLink>
            <NavLink to="/reports">통계/리포트</NavLink>
          </>
        )}
        {hasPermission('settings.manage') && (
          <>
            <div className="group">시스템</div>
            <NavLink to="/settings">시스템 설정</NavLink>
            <NavLink to="/scheduler">스케줄러</NavLink>
          </>
        )}
      </nav>
      <div className="main">
        <div className="topbar">
          <span>
            {user?.employee?.name ?? user?.email}
            {user?.employee?.departmentName ? ` · ${user.employee.departmentName}` : ''}
          </span>
          <button className="secondary" onClick={() => void logout()}>
            로그아웃
          </button>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
