import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { CODE_GROUPS } from '@daolerp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RequirePermission } from '../auth/permissions.decorator';

class UpsertCommonCodeDto {
  @IsIn([...CODE_GROUPS])
  groupCode: string;

  @IsString()
  @MinLength(1)
  code: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** 코드 조회는 로그인한 전 사용자, 관리(upsert)는 code.manage 권한 */
@Controller('codes')
export class CodesController {
  constructor(private readonly prisma: PrismaService) {}

  /** 화면 셀렉트 박스용 전체 코드 번들 */
  @Get()
  async all() {
    const [jobGrades, jobTitles, employmentTypes, commonCodes] = await Promise.all([
      this.prisma.jobGrade.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.jobTitle.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.employmentType.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.commonCode.findMany({
        where: { isActive: true },
        orderBy: [{ groupCode: 'asc' }, { sortOrder: 'asc' }],
      }),
    ]);
    return { jobGrades, jobTitles, employmentTypes, commonCodes };
  }

  @Post('common')
  @RequirePermission('code.manage')
  upsertCommon(@Body() dto: UpsertCommonCodeDto) {
    return this.prisma.commonCode.upsert({
      where: { groupCode_code: { groupCode: dto.groupCode, code: dto.code } },
      create: {
        groupCode: dto.groupCode,
        code: dto.code,
        name: dto.name,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
      update: { name: dto.name, sortOrder: dto.sortOrder, isActive: dto.isActive },
    });
  }
}
