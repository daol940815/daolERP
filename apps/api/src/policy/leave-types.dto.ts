import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { ATTACHMENT_RULES, LEAVE_PAID_TYPES } from '@daolerp/shared';

export class LeaveTypeInput {
  @IsString()
  @MinLength(1)
  code: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsIn([...LEAVE_PAID_TYPES])
  paidType: string;

  @IsBoolean()
  deductsAnnual = false;

  @IsIn([...ATTACHMENT_RULES])
  attachmentRule: string;

  @IsBoolean()
  allowHalfDay = false;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsBoolean()
  isActive = true;
}
