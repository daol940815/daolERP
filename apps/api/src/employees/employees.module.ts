import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { ResignationService } from './resignation.service';

@Module({
  imports: [LeaveModule],
  controllers: [EmployeesController],
  providers: [EmployeesService, ResignationService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
