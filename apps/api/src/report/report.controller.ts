import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { RequirePermission } from '../auth/permissions.decorator';
import { ReportService } from './report.service';

@Controller('reports')
export class ReportController {
  constructor(private readonly report: ReportService) {}

  /** 월별 근태 요약 — 마감된 달은 스냅샷, 아니면 실시간 계산 (기획서 4.11) */
  @Get('monthly/:yearMonth')
  @RequirePermission('report.read')
  monthly(@Param('yearMonth') yearMonth: string) {
    return this.report.monthlySummary(yearMonth);
  }

  @Get('monthly/:yearMonth/export')
  @RequirePermission('report.read')
  async export(@Param('yearMonth') yearMonth: string, @Res() res: Response) {
    const { rows, source } = await this.report.monthlySummary(yearMonth);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`${yearMonth} 근태 (${source})`);
    ws.columns = [
      { header: '사번', key: 'empNo', width: 10 },
      { header: '이름', key: 'employeeName', width: 12 },
      { header: '부서', key: 'departmentName', width: 14 },
      { header: '소정근무일', key: 'workdayCount', width: 12 },
      { header: '출근일', key: 'presentDays', width: 10 },
      { header: '결근일', key: 'absentDays', width: 10 },
      { header: '지각(회)', key: 'lateCount', width: 10 },
      { header: '지각(분)', key: 'lateMinutes', width: 10 },
      { header: '조퇴(회)', key: 'earlyLeaveCount', width: 10 },
      { header: '휴가일', key: 'leaveDays', width: 10 },
      { header: '근무시간(분)', key: 'workMinutes', width: 13 },
      { header: '초과근무(분)', key: 'overtimeMinutes', width: 13 },
    ];
    rows.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true };
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=report-${yearMonth}.xlsx`);
    res.send(buffer);
  }

  /** 연차 소멸 예정자 (촉진 대상 식별 — 기획서 4.11) */
  @Get('leave-expiry')
  @RequirePermission('report.read')
  leaveExpiry(@Query('withinDays') withinDays?: string) {
    return this.report.leaveExpiry(withinDays ? Number(withinDays) : 60);
  }

  /** 관리자 대시보드 (기획서 4.14) */
  @Get('dashboard')
  @RequirePermission('report.read')
  dashboard() {
    return this.report.dashboard();
  }
}
