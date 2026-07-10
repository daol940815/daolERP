import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClosingGuardService {
  constructor(private readonly prisma: PrismaService) {}

  /** 해당 일자('YYYY-MM-DD' 또는 Date)가 속한 월이 마감(CLOSED)이면 거부 */
  async assertOpen(date: string | Date): Promise<void> {
    const key = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
    const yearMonth = key.slice(0, 7);
    const closing = await this.prisma.monthlyClosing.findUnique({ where: { yearMonth } });
    if (closing?.status === 'CLOSED')
      throw new BadRequestException(
        `${yearMonth} 월은 마감되어 기록을 변경할 수 없습니다. HR에 마감 해제를 요청하세요.`,
      );
  }
}
