import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { addMonthsClamped } from '../leave/accrual-calculator';

export interface ImportRowResult {
  row: number;
  ok: boolean;
  error?: string;
  preview?: Record<string, unknown>;
}

export interface ImportResult {
  dryRun: boolean;
  total: number;
  valid: number;
  invalid: number;
  applied: number;
  rows: ImportRowResult[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cellStr(row: ExcelJS.Row, col: number): string {
  const v = row.getCell(col).value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && 'text' in v) return String((v as { text: unknown }).text).trim();
  return String(v).trim();
}

/**
 * Excel Import — 2단계 처리: dryRun(검증 미리보기) → 확정 반영 (기획서 4.15).
 * 내부는 파싱(포맷별) → 검증(공통) → 반영(공통) 3단계 — 향후 CSV/API 는 파서 추가로 확장.
 * 부서/승인라인 Import 는 후속 (기획서 4.15 표 중 직원/연차 초기값/휴일 우선 구현).
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async loadSheet(buffer: Buffer): Promise<ExcelJS.Worksheet> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as never);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('시트를 찾을 수 없습니다.');
    return ws;
  }

  /** 직원 Import — 사번 기준 upsert. 열: 사번|이름|입사일|부서명|직급코드|고용형태코드 */
  async employees(buffer: Buffer, dryRun: boolean, actor: { userId: number }): Promise<ImportResult> {
    const ws = await this.loadSheet(buffer);
    const results: ImportRowResult[] = [];
    const departments = await this.prisma.department.findMany();
    const grades = new Set((await this.prisma.jobGrade.findMany()).map((g) => g.code));
    const empTypes = new Set((await this.prisma.employmentType.findMany()).map((t) => t.code));

    interface Parsed { empNo: string; name: string; hireDate: string; departmentId: number | null; jobGradeCode: string | null; employmentTypeCode: string | null }
    const validRows: { row: number; data: Parsed }[] = [];

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // 헤더
      const empNo = cellStr(row, 1);
      const name = cellStr(row, 2);
      const hireDate = cellStr(row, 3);
      const deptName = cellStr(row, 4);
      const gradeCode = cellStr(row, 5);
      const empTypeCode = cellStr(row, 6);

      if (!empNo || !name) return void results.push({ row: rowNumber, ok: false, error: '사번/이름 누락' });
      if (!DATE_RE.test(hireDate)) return void results.push({ row: rowNumber, ok: false, error: `입사일 형식 오류: "${hireDate}" (YYYY-MM-DD)` });
      const dept = deptName ? departments.find((d) => d.name === deptName) : null;
      if (deptName && !dept) return void results.push({ row: rowNumber, ok: false, error: `존재하지 않는 부서: ${deptName}` });
      if (gradeCode && !grades.has(gradeCode)) return void results.push({ row: rowNumber, ok: false, error: `존재하지 않는 직급 코드: ${gradeCode}` });
      if (empTypeCode && !empTypes.has(empTypeCode)) return void results.push({ row: rowNumber, ok: false, error: `존재하지 않는 고용형태 코드: ${empTypeCode}` });

      const data: Parsed = {
        empNo, name, hireDate,
        departmentId: dept?.id ?? null,
        jobGradeCode: gradeCode || null,
        employmentTypeCode: empTypeCode || null,
      };
      results.push({ row: rowNumber, ok: true, preview: data as never });
      validRows.push({ row: rowNumber, data });
    });

    let applied = 0;
    if (!dryRun) {
      for (const { data } of validRows) {
        await this.prisma.employee.upsert({
          where: { empNo: data.empNo },
          create: {
            empNo: data.empNo, name: data.name, hireDate: new Date(data.hireDate),
            departmentId: data.departmentId, jobGradeCode: data.jobGradeCode,
            employmentTypeCode: data.employmentTypeCode,
          },
          update: {
            name: data.name, departmentId: data.departmentId,
            jobGradeCode: data.jobGradeCode, employmentTypeCode: data.employmentTypeCode,
          },
        });
        applied++;
      }
      await this.audit.log({
        targetType: 'import', targetId: 'employees', action: 'CREATE',
        after: { applied }, reason: `직원 Excel Import (${applied}건)`, actorUserId: actor.userId,
      });
    }
    return this.summarize(results, dryRun, applied);
  }

  /** 연차 초기값 Import — 오픈 시점 잔여를 초기 발생 건으로 (기획서 4.15). 열: 사번|잔여일수|발생일|사용기한(선택) */
  async leaveGrants(buffer: Buffer, dryRun: boolean, actor: { userId: number }): Promise<ImportResult> {
    const ws = await this.loadSheet(buffer);
    const results: ImportRowResult[] = [];
    const employees = new Map(
      (await this.prisma.employee.findMany()).map((e) => [e.empNo, e.id]),
    );
    interface Parsed { employeeId: number; empNo: string; days: number; grantDate: string; expireDate: string }
    const validRows: Parsed[] = [];

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const empNo = cellStr(row, 1);
      const days = Number(cellStr(row, 2));
      const grantDate = cellStr(row, 3);
      let expireDate = cellStr(row, 4);

      const employeeId = employees.get(empNo);
      if (!employeeId) return void results.push({ row: rowNumber, ok: false, error: `존재하지 않는 사번: ${empNo}` });
      if (!Number.isFinite(days) || days === 0) return void results.push({ row: rowNumber, ok: false, error: `잔여일수 오류: "${cellStr(row, 2)}"` });
      if (!DATE_RE.test(grantDate)) return void results.push({ row: rowNumber, ok: false, error: `발생일 형식 오류: "${grantDate}"` });
      if (expireDate && !DATE_RE.test(expireDate)) return void results.push({ row: rowNumber, ok: false, error: `사용기한 형식 오류: "${expireDate}"` });
      if (!expireDate) expireDate = addMonthsClamped(grantDate, 12);

      const data = { employeeId, empNo, days, grantDate, expireDate };
      results.push({ row: rowNumber, ok: true, preview: data as never });
      validRows.push(data);
    });

    let applied = 0;
    if (!dryRun) {
      for (const d of validRows) {
        const grantKey = `${d.employeeId}:INIT:${d.grantDate}`;
        const exists = await this.prisma.leaveGrant.findUnique({ where: { grantKey } });
        if (exists) continue; // 멱등 — 재업로드 시 중복 생성 방지
        await this.prisma.leaveGrant.create({
          data: {
            employeeId: d.employeeId, grantKey, grantDate: new Date(d.grantDate),
            days: d.days, expireDate: new Date(d.expireDate),
            reason: '[Import] 오픈 시점 잔여 연차 초기값',
          },
        });
        applied++;
      }
      await this.audit.log({
        targetType: 'import', targetId: 'leave_grants', action: 'CREATE',
        after: { applied }, reason: `연차 초기값 Excel Import (${applied}건)`, actorUserId: actor.userId,
      });
    }
    return this.summarize(results, dryRun, applied);
  }

  /** 휴일 Import — 열: 일자|휴일명|유형코드(STATUTORY/SUBSTITUTE/FOUNDATION/COMPANY/TEMPORARY) */
  async holidays(buffer: Buffer, dryRun: boolean, actor: { userId: number }): Promise<ImportResult> {
    const ws = await this.loadSheet(buffer);
    const results: ImportRowResult[] = [];
    const TYPES = new Set(['STATUTORY', 'SUBSTITUTE', 'FOUNDATION', 'COMPANY', 'TEMPORARY']);
    interface Parsed { date: string; name: string; holidayType: string }
    const validRows: Parsed[] = [];

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const date = cellStr(row, 1);
      const name = cellStr(row, 2);
      const holidayType = cellStr(row, 3) || 'STATUTORY';
      if (!DATE_RE.test(date)) return void results.push({ row: rowNumber, ok: false, error: `일자 형식 오류: "${date}"` });
      if (!name) return void results.push({ row: rowNumber, ok: false, error: '휴일명 누락' });
      if (!TYPES.has(holidayType)) return void results.push({ row: rowNumber, ok: false, error: `유형 오류: ${holidayType}` });
      const data = { date, name, holidayType };
      results.push({ row: rowNumber, ok: true, preview: data as never });
      validRows.push(data);
    });

    let applied = 0;
    if (!dryRun) {
      for (const d of validRows) {
        const exists = await this.prisma.holiday.findFirst({
          where: { date: new Date(d.date), departmentId: null },
        });
        if (exists) continue;
        await this.prisma.holiday.create({
          data: { date: new Date(d.date), name: d.name, holidayType: d.holidayType },
        });
        applied++;
      }
      await this.audit.log({
        targetType: 'import', targetId: 'holidays', action: 'CREATE',
        after: { applied }, reason: `휴일 Excel Import (${applied}건)`, actorUserId: actor.userId,
      });
    }
    return this.summarize(results, dryRun, applied);
  }

  private summarize(rows: ImportRowResult[], dryRun: boolean, applied: number): ImportResult {
    return {
      dryRun,
      total: rows.length,
      valid: rows.filter((r) => r.ok).length,
      invalid: rows.filter((r) => !r.ok).length,
      applied,
      rows,
    };
  }
}
