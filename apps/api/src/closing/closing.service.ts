import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ReportService, monthRange } from '../report/report.service';
import { LeavesService } from '../leave/leaves.service';

export interface ValidationIssue {
  level: 'BLOCKING' | 'WARNING';
  type: string;
  empNo: string;
  employeeName: string;
  detail: string;
}

/**
 * 월 마감 (기획서 4.10) — 상태기계: OPEN → VALIDATING → CLOSED → REOPENED → 재마감.
 * 마감 시 엔진 계산 결과를 스냅샷으로 확정 저장 (이후 정책 변경과 무관 — 급여 근거).
 */
@Injectable()
export class ClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly report: ReportService,
    private readonly leaves: LeavesService,
  ) {}

  get(yearMonth: string) {
    return this.prisma.monthlyClosing.findUnique({
      where: { yearMonth },
      include: { snapshots: { orderBy: { empNo: 'asc' } } },
    });
  }

  /** 마감 전 자동 검증 (기획서 CLS-02) */
  async validate(yearMonth: string): Promise<ValidationIssue[]> {
    const { from, to } = monthRange(yearMonth);
    const issues: ValidationIssue[] = [];
    const rows = await this.report.computeLive(yearMonth);

    for (const r of rows) {
      // 짝 없는 이벤트 — BLOCKING (보정 후 마감)
      if (r.incompleteCount > 0)
        issues.push({
          level: 'BLOCKING',
          type: '짝 없는 이벤트',
          empNo: r.empNo,
          employeeName: r.employeeName,
          detail: `출근/퇴근 기록 불완전 ${r.incompleteCount}일 — 보정 필요`,
        });
      // 기록 누락(결근) — WARNING (결근 확정 대상 확인)
      if (r.absentDays > 0)
        issues.push({
          level: 'WARNING',
          type: '기록 누락(결근)',
          empNo: r.empNo,
          employeeName: r.employeeName,
          detail: `결근 ${r.absentDays}일 — 결근 확정 여부 확인`,
        });
      // 근무시간 이상치 — WARNING (일 12h 초과 평균 아닌 총량 기준 근사)
      if (r.workMinutes > r.workdayCount * 12 * 60)
        issues.push({
          level: 'WARNING',
          type: '근무시간 이상치',
          empNo: r.empNo,
          employeeName: r.employeeName,
          detail: `월 근무 ${Math.round(r.workMinutes / 60)}시간 — 확인 필요`,
        });
      // 잔여 연차 음수 — BLOCKING
      const balance = await this.leaves.balance(r.employeeId);
      if (balance.summary.remaining < 0)
        issues.push({
          level: 'BLOCKING',
          type: '잔여 연차 음수',
          empNo: r.empNo,
          employeeName: r.employeeName,
          detail: `잔여 ${balance.summary.remaining}일 — 조정 필요`,
        });
    }

    // 미처리 신청 (승인 대기) — BLOCKING
    const [pendingLeaves, pendingCorr, pendingOt] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { status: 'REQUESTED', startDate: { lte: to }, endDate: { gte: from } },
        include: { employee: { select: { empNo: true, name: true } } },
      }),
      this.prisma.attendanceCorrection.findMany({
        where: { status: 'REQUESTED', date: { gte: from, lte: to } },
        include: { employee: { select: { empNo: true, name: true } } },
      }),
      this.prisma.overtimeRequest.findMany({
        where: { status: 'REQUESTED', date: { gte: from, lte: to } },
        include: { employee: { select: { empNo: true, name: true } } },
      }),
    ]);
    for (const [label, list] of [
      ['휴가', pendingLeaves],
      ['근태 보정', pendingCorr],
      ['초과근무', pendingOt],
    ] as const) {
      for (const p of list) {
        issues.push({
          level: 'BLOCKING',
          type: '미처리 신청',
          empNo: p.employee.empNo,
          employeeName: p.employee.name,
          detail: `승인 대기 중인 ${label} 신청 (#${p.id}) — 처리 후 마감`,
        });
      }
    }

    // 휴가 중복 승인 — WARNING (신청 단계에서 차단되지만 방어적 검사)
    const approvedLeaves = await this.prisma.leaveRequest.findMany({
      where: { status: { in: ['APPROVED', 'CANCEL_REQUESTED'] }, startDate: { lte: to }, endDate: { gte: from } },
      include: { employee: { select: { empNo: true, name: true } } },
    });
    for (let i = 0; i < approvedLeaves.length; i++) {
      for (let j = i + 1; j < approvedLeaves.length; j++) {
        const a = approvedLeaves[i];
        const b = approvedLeaves[j];
        if (a.employeeId === b.employeeId && a.startDate <= b.endDate && b.startDate <= a.endDate) {
          issues.push({
            level: 'WARNING',
            type: '휴가 중복',
            empNo: a.employee.empNo,
            employeeName: a.employee.name,
            detail: `승인 휴가 #${a.id} / #${b.id} 기간 중복`,
          });
        }
      }
    }
    return issues;
  }

  /** 마감 실행 — 검증 통과(BLOCKING 없음) 시 스냅샷 생성 후 CLOSED (기획서 5.3) */
  async close(yearMonth: string, actor: { userId: number; ip?: string }) {
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw new BadRequestException('yearMonth 형식: YYYY-MM');
    const currentMonth = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).slice(0, 7);
    if (yearMonth >= currentMonth)
      throw new BadRequestException('진행 중인 달은 마감할 수 없습니다 (지난달부터 가능).');

    const existing = await this.prisma.monthlyClosing.findUnique({ where: { yearMonth } });
    if (existing?.status === 'CLOSED') throw new BadRequestException('이미 마감된 달입니다.');

    // VALIDATING 상태 기록 → 검증
    const closing = await this.prisma.monthlyClosing.upsert({
      where: { yearMonth },
      create: { yearMonth, status: 'VALIDATING', executedBy: actor.userId },
      update: { status: 'VALIDATING', executedBy: actor.userId },
    });

    const issues = await this.validate(yearMonth);
    const blocking = issues.filter((i) => i.level === 'BLOCKING');
    if (blocking.length > 0) {
      // 검증 실패 → OPEN 복귀 + 이상 건 목록 (기획서 5.3)
      await this.prisma.monthlyClosing.update({
        where: { id: closing.id },
        data: { status: existing?.status === 'REOPENED' ? 'REOPENED' : 'OPEN', validationResult: issues as never },
      });
      return { closed: false, issues };
    }

    // 스냅샷 생성 (재마감 시 기존 스냅샷 재생성 — 기획서 CLS-03)
    const rows = await this.report.computeLive(yearMonth);
    await this.prisma.$transaction(async (tx) => {
      await tx.closingSnapshot.deleteMany({ where: { closingId: closing.id } });
      for (const r of rows) {
        await tx.closingSnapshot.create({
          data: {
            closingId: closing.id,
            employeeId: r.employeeId,
            empNo: r.empNo,
            employeeName: r.employeeName,
            departmentName: r.departmentName,
            workdayCount: r.workdayCount,
            presentDays: r.presentDays,
            absentDays: r.absentDays,
            lateCount: r.lateCount,
            lateMinutes: r.lateMinutes,
            earlyLeaveCount: r.earlyLeaveCount,
            incompleteCount: r.incompleteCount,
            leaveDays: r.leaveDays,
            workMinutes: r.workMinutes,
            overtimeMinutes: r.overtimeMinutes,
          },
        });
      }
      await tx.monthlyClosing.update({
        where: { id: closing.id },
        data: { status: 'CLOSED', closedAt: new Date(), validationResult: issues as never },
      });
      await this.audit.log(
        {
          targetType: 'monthly_closing',
          targetId: yearMonth,
          action: 'UPDATE',
          before: { status: existing?.status ?? 'OPEN' },
          after: { status: 'CLOSED', snapshotCount: rows.length },
          reason: `${yearMonth} 월 마감 실행`,
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
    });
    return { closed: true, snapshotCount: rows.length, issues };
  }

  /** 마감 해제 — HR만, 사유 필수 (기획서 CLS-03) */
  async reopen(yearMonth: string, reason: string, actor: { userId: number; ip?: string }) {
    const closing = await this.prisma.monthlyClosing.findUnique({ where: { yearMonth } });
    if (!closing || closing.status !== 'CLOSED')
      throw new BadRequestException('마감된 달이 아닙니다.');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.monthlyClosing.update({
        where: { id: closing.id },
        data: { status: 'REOPENED', reopenReason: reason },
      });
      await this.audit.log(
        {
          targetType: 'monthly_closing',
          targetId: yearMonth,
          action: 'UPDATE',
          before: { status: 'CLOSED' },
          after: { status: 'REOPENED' },
          reason,
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return updated;
    });
  }

  /** 급여용 스냅샷 Excel 내보내기 (기획서 CLS-04) */
  async exportXlsx(yearMonth: string): Promise<Buffer> {
    const closing = await this.get(yearMonth);
    if (!closing || closing.status !== 'CLOSED')
      throw new BadRequestException('마감된 달만 내보낼 수 있습니다.');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`${yearMonth} 마감`);
    ws.columns = [
      { header: '사번', key: 'empNo', width: 10 },
      { header: '이름', key: 'name', width: 12 },
      { header: '부서', key: 'dept', width: 14 },
      { header: '소정근무일', key: 'workdays', width: 12 },
      { header: '출근일', key: 'present', width: 10 },
      { header: '결근일', key: 'absent', width: 10 },
      { header: '지각(회)', key: 'lateCount', width: 10 },
      { header: '지각(분)', key: 'lateMin', width: 10 },
      { header: '조퇴(회)', key: 'early', width: 10 },
      { header: '휴가일', key: 'leave', width: 10 },
      { header: '근무시간(분)', key: 'workMin', width: 13 },
      { header: '초과근무(분)', key: 'otMin', width: 13 },
    ];
    for (const s of closing.snapshots) {
      ws.addRow({
        empNo: s.empNo,
        name: s.employeeName,
        dept: s.departmentName ?? '',
        workdays: s.workdayCount,
        present: s.presentDays,
        absent: s.absentDays,
        lateCount: s.lateCount,
        lateMin: s.lateMinutes,
        early: s.earlyLeaveCount,
        leave: s.leaveDays,
        workMin: s.workMinutes,
        otMin: s.overtimeMinutes,
      });
    }
    ws.getRow(1).font = { bold: true };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
