import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EmployeeChangeType } from '@daolerp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateEmployeeDto, UpdateEmployeeDto } from './employees.dto';

/** 발효일 이력 대상 필드 → 변경 유형 매핑 (기획서 4.1.2) */
const HISTORY_FIELDS: Record<string, EmployeeChangeType> = {
  departmentId: 'DEPARTMENT',
  jobGradeCode: 'JOB_GRADE',
  jobTitleCode: 'JOB_TITLE',
  employmentTypeCode: 'EMPLOYMENT_TYPE',
  workTypeCode: 'WORK_TYPE',
  status: 'STATUS',
};

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(params: { departmentId?: number; status?: string; q?: string }) {
    return this.prisma.employee.findMany({
      where: {
        departmentId: params.departmentId,
        status: params.status,
        OR: params.q
          ? [
              { name: { contains: params.q } },
              { empNo: { contains: params.q } },
              { email: { contains: params.q } },
            ]
          : undefined,
      },
      include: {
        department: { select: { id: true, name: true } },
        jobGrade: true,
        jobTitle: true,
        employmentType: true,
      },
      orderBy: [{ empNo: 'asc' }],
    });
  }

  async findOne(id: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true } },
        jobGrade: true,
        jobTitle: true,
        employmentType: true,
        histories: { orderBy: { effectiveDate: 'desc' }, take: 50 },
      },
    });
    if (!employee) throw new NotFoundException('직원을 찾을 수 없습니다.');
    return employee;
  }

  async create(dto: CreateEmployeeDto, actor: { userId: number; ip?: string }) {
    const exists = await this.prisma.employee.findUnique({ where: { empNo: dto.empNo } });
    if (exists) throw new BadRequestException(`이미 존재하는 사번입니다: ${dto.empNo}`);

    const employee = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({
        data: {
          empNo: dto.empNo,
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          hireDate: new Date(dto.hireDate),
          departmentId: dto.departmentId,
          jobGradeCode: dto.jobGradeCode,
          jobTitleCode: dto.jobTitleCode,
          employmentTypeCode: dto.employmentTypeCode,
          workTypeCode: dto.workTypeCode,
        },
      });
      await this.audit.log(
        {
          targetType: 'employee',
          targetId: created.id,
          action: 'CREATE',
          after: created,
          reason: dto.reason ?? '직원 등록',
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return created;
    });
    return employee;
  }

  /**
   * 직원 수정 — 이력 대상 필드(부서/직급/직책/고용형태/근무형태/상태)가 바뀌면
   * 발효일 기준 employee_histories 를 함께 기록한다. 이때 사유·발효일 필수.
   */
  async update(id: number, dto: UpdateEmployeeDto, actor: { userId: number; ip?: string }) {
    const before = await this.prisma.employee.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('직원을 찾을 수 없습니다.');

    const changedHistoryFields = Object.keys(HISTORY_FIELDS).filter(
      (f) => (dto as Record<string, unknown>)[f] !== undefined
        && (dto as Record<string, unknown>)[f] !== (before as Record<string, unknown>)[f],
    );
    if (changedHistoryFields.length > 0) {
      if (!dto.reason) throw new BadRequestException('이력 대상 변경에는 사유가 필수입니다.');
      if (!dto.effectiveDate)
        throw new BadRequestException('이력 대상 변경에는 발효일이 필수입니다.');
    }

    return this.prisma.$transaction(async (tx) => {
      const after = await tx.employee.update({
        where: { id },
        data: {
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          departmentId: dto.departmentId,
          jobGradeCode: dto.jobGradeCode,
          jobTitleCode: dto.jobTitleCode,
          employmentTypeCode: dto.employmentTypeCode,
          workTypeCode: dto.workTypeCode,
          status: dto.status,
          resignDate: dto.resignDate ? new Date(dto.resignDate) : undefined,
        },
      });

      for (const field of changedHistoryFields) {
        await tx.employeeHistory.create({
          data: {
            employeeId: id,
            changeType: HISTORY_FIELDS[field],
            beforeValue: { [field]: (before as Record<string, unknown>)[field] ?? null },
            afterValue: { [field]: (after as Record<string, unknown>)[field] ?? null },
            effectiveDate: new Date(dto.effectiveDate!),
            reason: dto.reason!,
            createdBy: actor.userId,
          },
        });
      }

      await this.audit.log(
        {
          targetType: 'employee',
          targetId: id,
          action: 'UPDATE',
          before,
          after,
          reason: dto.reason ?? '직원 정보 수정',
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return after;
    });
  }
}
