import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { AuditModule } from './audit/audit.module';
import { EmployeesModule } from './employees/employees.module';
import { DepartmentsModule } from './departments/departments.module';
import { CodesModule } from './codes/codes.module';
import { UsersModule } from './users/users.module';
import { SettingsModule } from './settings/settings.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { PolicyModule } from './policy/policy.module';
import { ScheduleModule as WorkScheduleModule } from './schedule/schedule.module';
import { ApprovalModule } from './approval/approval.module';
import { AttendanceEngineModule } from './attendance-engine/attendance-engine.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AttachmentModule } from './attachment/attachment.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    EmployeesModule,
    DepartmentsModule,
    CodesModule,
    SettingsModule,
    SchedulerModule,
    PolicyModule,
    WorkScheduleModule,
    ApprovalModule,
    AttendanceEngineModule,
    AttendanceModule,
    AttachmentModule,
  ],
  providers: [
    // 전역 인증 → 권한 순서로 적용. @Public() 로 예외 지정.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
