import {
  BadRequestException,
  Controller,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RequirePermission } from '../auth/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ImportService } from './import.service';

/**
 * Excel Import (기획서 4.15) — dryRun=true(기본): 검증 미리보기, dryRun=false: 확정 반영.
 * POST /imports/{employees|leave-grants|holidays}?dryRun=false
 */
@Controller('imports')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  @Post(':target')
  @RequirePermission('employee.manage')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  async run(
    @Param('target') target: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
    @Query('dryRun') dryRun?: string,
  ) {
    if (!file) throw new BadRequestException('파일이 없습니다 (.xlsx).');
    const isDry = dryRun !== 'false'; // 기본 dryRun — 명시적으로 false 여야 반영
    const actor = { userId: user.id };
    switch (target) {
      case 'employees':
        return this.imports.employees(file.buffer, isDry, actor);
      case 'leave-grants':
        return this.imports.leaveGrants(file.buffer, isDry, actor);
      case 'holidays':
        return this.imports.holidays(file.buffer, isDry, actor);
      default:
        throw new BadRequestException(`지원하지 않는 대상: ${target} (employees | leave-grants | holidays)`);
    }
  }
}
