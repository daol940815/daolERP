import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import type { Request } from 'express';
import { RequirePermission } from '../auth/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { DepartmentsService } from './departments.service';

class CreateDepartmentDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsInt()
  parentId?: number;

  @IsOptional()
  @IsInt()
  headEmployeeId?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  parentId?: number;

  @IsOptional()
  @IsInt()
  headEmployeeId?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermission('employee.read')
  list() {
    return this.departments.list();
  }

  @Post()
  @RequirePermission('department.manage')
  create(@Body() dto: CreateDepartmentDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.departments.create(dto, { userId: user.id, ip: req.ip });
  }

  @Patch(':id')
  @RequirePermission('department.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.departments.update(id, dto, { userId: user.id, ip: req.ip });
  }
}
