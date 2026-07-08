import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
const ALLOWED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.xlsx', '.docx', '.hwp', '.zip']);
const MAX_SIZE = 10 * 1024 * 1024; // 10MB — 추후 system_settings 로 이동

/**
 * 첨부파일 (범용 — 기획서 4.8).
 * 업로드 → id 반환 → 신청 생성 시 refType/refId 연결.
 * 접근: 업로더 본인 또는 attendance.read ALL(HR) — 승인자 접근은 참조 유형별 확장.
 */
@Controller('attachments')
export class AttachmentController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) =>
          cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`),
      }),
      limits: { fileSize: MAX_SIZE },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser) {
    if (!file) throw new BadRequestException('파일이 없습니다.');
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) throw new BadRequestException(`허용되지 않는 확장자입니다: ${ext}`);

    // 한글 파일명 복원 (multer latin1 인코딩 이슈)
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    return this.prisma.attachment.create({
      data: {
        fileName,
        storedPath: file.path,
        mimeType: file.mimetype,
        size: file.size,
        uploadedBy: user.id,
      },
      select: { id: true, fileName: true, size: true, mimeType: true },
    });
  }

  @Get(':id/download')
  async download(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const att = await this.prisma.attachment.findUnique({ where: { id } });
    if (!att || att.deletedAt) throw new NotFoundException('첨부파일을 찾을 수 없습니다.');

    const isOwner = att.uploadedBy === user.id;
    const isHr = user.permissions.some((p) => p.action === 'attendance.read' && p.scope === 'ALL');
    if (!isOwner && !isHr) throw new ForbiddenException('첨부파일에 접근할 권한이 없습니다.');

    if (!existsSync(att.storedPath)) throw new NotFoundException('파일이 저장소에 없습니다.');
    res.setHeader('Content-Type', att.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(att.fileName)}`,
    );
    createReadStream(att.storedPath).pipe(res);
  }
}
