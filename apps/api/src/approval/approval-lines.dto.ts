import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { APPROVER_TYPES, REQUEST_TYPES } from '@daolerp/shared';

export class ApprovalStepInput {
  @IsIn([...APPROVER_TYPES])
  approverType: string;

  @IsOptional()
  @IsInt()
  approverEmployeeId?: number;

  @IsOptional()
  @IsString()
  approverJobTitleCode?: string;
}

export class CreateApprovalLineDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsIn([...REQUEST_TYPES])
  requestType: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ApprovalStepInput)
  steps: ApprovalStepInput[];
}

export class AssignApprovalLineDto {
  @IsOptional()
  @IsInt()
  employeeId?: number;

  @IsOptional()
  @IsInt()
  departmentId?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
