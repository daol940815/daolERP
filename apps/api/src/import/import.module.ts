import { Module } from '@nestjs/common';
import { ImportService } from './import.service';
import { ImportController } from './import.controller';

/** 데이터 Import 모듈 (기획서 4.15) — 파싱→검증→반영 3단계, dryRun 지원 */
@Module({
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
