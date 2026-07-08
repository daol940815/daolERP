import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import type { Request } from 'express';
import { RequirePermission } from '../auth/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { HolidaysService } from './holidays.service';
import { HolidayInput } from './holidays.dto';

class DeleteHolidayDto {
  @IsString()
  @MinLength(1)
  reason: string;
}

@Controller('holidays')
export class HolidaysController {
  constructor(private readonly service: HolidaysService) {}

  @Get()
  @RequirePermission('policy.read')
  list(@Query('year') year?: string) {
    return this.service.list(year ? Number(year) : undefined);
  }

  @Post()
  @RequirePermission('policy.manage')
  create(@Body() dto: HolidayInput, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.create(dto, { userId: user.id, ip: req.ip });
  }

  @Delete(':id')
  @RequirePermission('policy.manage')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeleteHolidayDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.remove(id, dto.reason, { userId: user.id, ip: req.ip });
  }
}
