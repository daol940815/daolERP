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
    { action: 'policy.read', scope: 'ALL' },
    { action: 'policy.manage', scope: 'ALL' },
    { action: 'schedule.read', scope: 'ALL' },
    { action: 'schedule.manage', scope: 'ALL' },
    { action: 'approval.manage', scope: 'ALL' },
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
    { action: 'policy.read', scope: 'ALL' },
    { action: 'policy.manage', scope: 'ALL' },
    { action: 'schedule.read', scope: 'ALL' },
    { action: 'schedule.manage', scope: 'ALL' },
    { action: 'approval.manage', scope: 'ALL' },
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
    // 전사 기본 정책 (배정 우선순위의 최종 fallback — 기획서 4.1.1). 0 = 미지정
    'policy.defaultWorkPolicyId': 0,
    'policy.defaultLeavePolicyId': 0,
  };
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: value as never },
      update: {},
    });
  }
}

// M2 — 기본 근무정책/연차정책/휴가유형 (기획서 4.2/4.5). 값은 화면에서 조정 가능.
async function seedPolicies() {
  // 근무정책: 사무직 표준(고정) — 전사 기본값 후보
  let office = await prisma.workPolicy.findFirst({ where: { name: '사무직 표준' } });
  if (!office) {
    office = await prisma.workPolicy.create({ data: { name: '사무직 표준', type: 'FIXED' } });
    await prisma.workPolicyVersion.create({
      data: {
        workPolicyId: office.id,
        effectiveDate: new Date('2020-01-01'),
        startTime: '09:00',
        endTime: '18:00',
        breakMinutes: 60,
        standardWorkMinutes: 480,
        lateGraceMinutes: 0,
        reason: '초기 등록',
        createdBy: 1,
      },
    });
  }
  // 임원(자율) — 예시
  let exec = await prisma.workPolicy.findFirst({ where: { name: '임원' } });
  if (!exec) {
    exec = await prisma.workPolicy.create({ data: { name: '임원', type: 'AUTONOMOUS' } });
    await prisma.workPolicyVersion.create({
      data: {
        workPolicyId: exec.id,
        effectiveDate: new Date('2020-01-01'),
        breakMinutes: 60,
        standardWorkMinutes: 480,
        reason: '초기 등록',
        createdBy: 1,
      },
    });
  }

  // 연차정책: 표준(입사일 기준 — #1 확정) — 전사 기본값 후보
  let leaveStd = await prisma.leavePolicy.findFirst({ where: { name: '표준 연차정책' } });
  if (!leaveStd) {
    leaveStd = await prisma.leavePolicy.create({
      data: {
        name: '표준 연차정책',
        grantBasis: 'HIRE_DATE',
        expireMonths: 12,
        carryOver: false,
        autoExpire: true,
        promotionDays: [60, 30],
        minUnit: 0.5,
      },
    });
  }

  // 전사 기본값 지정
  await prisma.systemSetting.update({
    where: { key: 'policy.defaultWorkPolicyId' },
    data: { value: office.id as never },
  });
  await prisma.systemSetting.update({
    where: { key: 'policy.defaultLeavePolicyId' },
    data: { value: leaveStd.id as never },
  });

  // 휴가 유형 (기획서 4.5.1)
  const leaveTypes: {
    code: string; name: string; paidType: string; deductsAnnual: boolean;
    attachmentRule: string; allowHalfDay: boolean;
  }[] = [
    { code: 'ANNUAL', name: '연차', paidType: 'PAID', deductsAnnual: true, attachmentRule: 'NONE', allowHalfDay: true },
    { code: 'SUBSTITUTE', name: '대체휴가', paidType: 'PAID', deductsAnnual: false, attachmentRule: 'NONE', allowHalfDay: true },
    { code: 'CONDOLENCE', name: '경조휴가', paidType: 'PAID', deductsAnnual: false, attachmentRule: 'OPTIONAL', allowHalfDay: false },
    { code: 'SICK', name: '병가', paidType: 'POLICY', deductsAnnual: false, attachmentRule: 'REQUIRED', allowHalfDay: false },
    { code: 'OFFICIAL', name: '공가', paidType: 'PAID', deductsAnnual: false, attachmentRule: 'OPTIONAL', allowHalfDay: false },
    { code: 'UNPAID', name: '무급휴가', paidType: 'UNPAID', deductsAnnual: false, attachmentRule: 'NONE', allowHalfDay: false },
  ];
  for (const [i, t] of leaveTypes.entries()) {
    await prisma.leaveType.upsert({
      where: { code: t.code },
      create: { ...t, sortOrder: i },
      update: { name: t.name, sortOrder: i },
    });
  }
}

async function seedSchedulerJobs() {
  // M2+ 에서 핸들러가 구현될 작업 정의 (기획서 5.4) — 기본 비활성
  const jobs: [string, string, string][] = [
    ['work-schedule-generate', '0 2 25 * *', '익월 근무일정 생성'],
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

// M3 — 기본 승인라인 (기획서 4.7). 유형별 전사 기본 라인 1개씩.
async function seedApprovalLines() {
  const defaults: { name: string; requestType: string }[] = [
    { name: '일반 휴가 라인', requestType: 'LEAVE' },
    { name: '초과근무 라인', requestType: 'OVERTIME' },
    { name: '근태 보정 라인', requestType: 'ATTENDANCE_CORRECTION' },
  ];
  for (const d of defaults) {
    const existing = await prisma.approvalLine.findFirst({
      where: { requestType: d.requestType, isDefault: true },
    });
    if (existing) continue;
    await prisma.approvalLine.create({
      data: {
        name: d.name,
        requestType: d.requestType,
        isDefault: true,
        // 1단계: 직속 부서장 (기획서 예시)
        steps: { create: [{ stepOrder: 1, approverType: 'DEPT_HEAD' }] },
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
  await seedPolicies();
  await seedApprovalLines();
  console.log('시드 완료');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
