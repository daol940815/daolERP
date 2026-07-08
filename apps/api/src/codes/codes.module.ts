import { Module } from '@nestjs/common';
import { CodesController } from './codes.controller';

@Module({
  controllers: [CodesController],
})
export class CodesModule {}
