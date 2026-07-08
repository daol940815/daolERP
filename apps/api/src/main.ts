// 시간 기준: 서버 시간 KST 단일 기준 (기획서 6장) — Nest 부팅 전에 고정
process.env.TZ ??= 'Asia/Seoul';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.listen(process.env.API_PORT ?? 3000);
}
bootstrap();
