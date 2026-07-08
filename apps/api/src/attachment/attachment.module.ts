import { Module } from '@nestjs/common';
import { AttachmentController } from './attachment.controller';

/** 첨부파일 모듈 — 범용 구조, ERP 병합 시 File Service 승격 후보 (기획서 10.3) */
@Module({
  controllers: [AttachmentController],
})
export class AttachmentModule {}
