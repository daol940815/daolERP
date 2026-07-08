// 초기 데이터 시드 — 역할/권한, 기본 코드, 관리자 계정, 시스템 설정, 스케줄러 작업 정의.
// 멱등: 여러 번 실행해도 안전 (upsert 기반).
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// 역할별 권한 매핑 (기획서 3.2/3.3 — M1 범위)
const ROLE_PERMISSIONS: Record<string, { action: string; scope: string }[]> = {
  EMPLOYEE: [{ action: 'employee.read', scope: 'SELF' }],
  APPROVER: [{ action: 'employee.read', scope: 'DEPT' }],
  HR: [
    { action: 'employee.read', scope: 'ALL' },
    { action: 'employee.manage', scope: 'ALL' },
    { action: 'department.manage', scope: 'ALL' },
    { action: 'code.manage', scope: 'ALL' },
    { action: 'scheduler.read', scope: 'ALL' },
    { action: 'scheduler.execute', scope: 'ALL' },
    { action: 'audit.read', scope: 'ALL' },
  ],
  ADMIN: [
    { action: 'employee.read', scope: 'ALL' },
    { action: 'employee.manage', scope: 'ALL' },
    { action: 'department.manage', scope: 'ALL' },
    { action: 'user.manage', scope: 'ALL' },
    { action: 'code.manage', scope: 'ALL' },
    { action: 'settings.manage', scope: 'ALL' },
    { action: 'scheduler.read', scope: 'ALL' },
    { action: 'scheduler.execute', scope: 'ALL' },
    { action: 'audit.read', scope: 'ALL' },
  ],
};

const ROLE_NAMES: Record<string, string> = {
  EMPLOYEE: '일반 직원',
  APPROVER: '승인자',
  HR: '인사 담당자',
  ADMIN: '시스템 관리자',
};

async function seedRolesAndPermissions() {
  const allPerms = new Map<string, { action: string; scope: string }>();
  for (const perms of Object.values(ROLE_PERMISSIONS)) {
    for (const p of perms) allPerms.set(`${p.action}:${p.scope}`, p);
  }
  for (const p of allPerms.values()) {
    await prisma.permission.upsert({
      where: { action_scope: { action: p.action, scope: p.scope } },
      create: p,
      update: {},
    });
  }
  for (const [code, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { code },
      create: { code, name: ROLE_NAMES[code] },
      update: { name: ROLE_NAMES[code] },
    });
    for (const p of perms) {
      const perm = await prisma.permission.findUniqueOrThrow({
        where: { action_scope: { action: p.action, scope: p.scope } },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        create: { roleId: role.id, permissionId: perm.id },
        update: {},
      });
    }
  }
}

async function seedCodes() {
  const jobGrades = [
    ['E1', '사원'], ['E2', '대리'], ['E3', '과장'], ['E4', '차장'], ['E5', '부장'], ['EX', '임원'],
  ];
  for (const [i, [code, name]] of jobGrades.entries()) {
    await prisma.jobGrade.upsert({
      where: { code },
      create: { code, name, sortOrder: i },
      update: { name, sortOrder: i },
    });
  }
  const jobTitles = [
    ['TL', '팀장'], ['DH', '본부장'], ['CEO', '대표'],
  ];
  for (const [i, [code, name]] of jobTitles.entries()) {
    await prisma.jobTitle.upsert({
      where: { code },
      create: { code, name, sortOrder: i },
      update: { name, sortOrder: i },
    });
  }
  const employmentTypes = [
    ['FULL', '정규직'], ['CONTRACT', '계약직'], ['PART', '아르바이트'], ['DISPATCH', '파견'],
  ];
  for (const [i, [code, name]] of employmentTypes.entries()) {
    await prisma.employmentType.upsert({
      where: { code },
      create: { code, name, sortOrder: i },
      update: { name, sortOrder: i },
    });
  }
  const workTypes = [
    ['OFFICE', '일반(사무실)'], ['REMOTE', '재택'], ['HYBRID', '하이브리드'], ['FLEX', '시차근무'],
  ];
  for (const [i, [code, name]] of workTypes.entries()) {
    await prisma.commonCode.upsert({
      where: { groupCode_code: { groupCode: 'WORK_TYPE', code } },
      create: { groupCode: 'WORK_TYPE', code, name, sortOrder: i },
      update: { name, sortOrder: i },
    });
  }
}

async function seedSettings() {
  // 법인 복제 시 변경 지점 (기획서 4.13)
  const defaults: Record<string, unknown> = {
    'company.name': '다올커머스',
    'company.bizNo': '',
    'company.ceo': '',
    'company.address': '',
    'mail.smtpHost': '',
    'mail.smtpPort': 587,
    'mail.sender': '',
    'attendance.allowedIpRanges': [],
    'attendance.weeklyHourAlertThreshold': 48,
  };
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: value as never },
      update: {},
    });
  }
}

async function seedSchedulerJobs() {
  // M2+ 에서 핸들러가 구현될 작업 정의 (기획서 5.4) — 기본 비활성
  const jobs: [string, string, string][] = [
    ['work-schedule-generate', '0 2 25 * *', '익월 근무일정 생성 (M3 구현)'],
    ['leave-grant', '0 3 * * *', '연차 발생 (M5 구현)'],
    ['leave-expire', '0 4 * * *', '연차 소멸 (M5 구현)'],
    ['leave-promotion-alert', '0 5 * * *', '연차 촉진 알림 (M5 구현)'],
    ['weekly-hours-check', '0 6 * * *', '주 52시간 체크 (M6 구현)'],
    ['notification-dispatch', '*/1 * * * *', '알림 아웃박스 발송 (M6 구현)'],
  ];
  for (const [name, cron, description] of jobs) {
    await prisma.schedulerJob.upsert({
      where: { name },
      create: { name, cron, description, isActive: false },
      update: { description },
    });
  }
}

async function seedAdmin() {
  const dept = await prisma.department.findFirst({ where: { name: '경영지원' } })
    ?? await prisma.department.create({ data: { name: '경영지원', sortOrder: 0 } });

  const admin = await prisma.user.findUnique({ where: { email: 'admin@daolerp.local' } });
  if (!admin) {
    const employee = await prisma.employee.create({
      data: {
        empNo: 'A0001',
        name: '시스템 관리자',
        hireDate: new Date('2020-01-01'),
        departmentId: dept.id,
        employmentTypeCode: 'FULL',
        workTypeCode: 'OFFICE',
      },
    });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    const hrRole = await prisma.role.findUniqueOrThrow({ where: { code: 'HR' } });
    await prisma.user.create({
      data: {
        email: 'admin@daolerp.local',
        // 초기 비밀번호 — 최초 로그인 후 변경 필수 (운영 배포 전 정책 추가 예정)
        passwordHash: await bcrypt.hash('admin1234!', 10),
        employeeId: employee.id,
        userRoles: { create: [{ roleId: adminRole.id }, { roleId: hrRole.id }] },
      },
    });
  }
}

async function main() {
  await seedRolesAndPermissions();
  await seedCodes();
  await seedSettings();
  await seedSchedulerJobs();
  await seedAdmin();
  console.log('시드 완료');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
