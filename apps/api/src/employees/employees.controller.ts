import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../auth/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './employees.dto';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermission('employee.read')
  list(
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    return this.employees.list({
      departmentId: departmentId ? Number(departmentId) : undefined,
      status,
      q,
    });
  }

  @Get(':id')
  @RequirePermission('employee.read')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.employees.findOne(id);
  }

  @Post()
  @RequirePermission('employee.manage')
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.employees.create(dto, { userId: user.id, ip: req.ip });
  }

  @Patch(':id')
  @RequirePermission('employee.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.employees.update(id, dto, { userId: user.id, ip: req.ip });
  }
}
