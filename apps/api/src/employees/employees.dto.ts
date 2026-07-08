import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { EMPLOYEE_STATUS } from '@daolerp/shared';

export class CreateEmployeeDto {
  @IsString()
  @MinLength(1)
  empNo: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsDateString()
  hireDate: string;

  @IsOptional()
  @IsInt()
  departmentId?: number;

  @IsOptional()
  @IsString()
  jobGradeCode?: string;

  @IsOptional()
  @IsString()
  jobTitleCode?: string;

  @IsOptional()
  @IsString()
  employmentTypeCode?: string;

  @IsOptional()
  @IsString()
  workTypeCode?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsInt()
  departmentId?: number;

  @IsOptional()
  @IsString()
  jobGradeCode?: string;

  @IsOptional()
  @IsString()
  jobTitleCode?: string;

  @IsOptional()
  @IsString()
  employmentTypeCode?: string;

  @IsOptional()
  @IsString()
  workTypeCode?: string;

  @IsOptional()
  @IsIn([...EMPLOYEE_STATUS])
  status?: string;

  @IsOptional()
  @IsDateString()
  resignDate?: string;

  // 정책 개별 배정 (기획서 4.1.1). null 로 보내면 부서/전사 기본값으로 되돌림.
  @IsOptional()
  @IsInt()
  workPolicyId?: number | null;

  @IsOptional()
  @IsInt()
  leavePolicyId?: number | null;

  /** 이력 대상 필드 변경 시 필수 */
  @IsOptional()
  @IsString()
  reason?: string;

  /** 이력 대상 필드 변경 시 필수 (발효일) */
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;
}
