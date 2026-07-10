// 시간 기준: 서버 시간 KST 단일 기준 (기획서 6장) — Nest 부팅 전에 고정
process.env.TZ ??= 'Asia/Seoul';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // 운영 안전장치: 예시 시크릿 그대로 배포 방지
  if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET === 'change-me-in-production') {
    // eslint-disable-next-line no-console
    console.error('JWT_SECRET 이 예시 값입니다. 운영 배포 전 반드시 변경하세요.');
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.listen(process.env.API_PORT ?? 3000);
}
bootstrap();
