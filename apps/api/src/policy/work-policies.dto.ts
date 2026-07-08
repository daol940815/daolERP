import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WORK_POLICY_TYPES } from '@daolerp/shared';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class WorkPolicyVersionInput {
  @IsDateString()
  effectiveDate: string;

  @IsOptional()
  @Matches(HHMM, { message: 'startTime 은 HH:MM 형식이어야 합니다.' })
  startTime?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'endTime 은 HH:MM 형식이어야 합니다.' })
  endTime?: string;

  @IsOptional()
  @IsInt()
  breakMinutes?: number;

  @IsOptional()
  @IsInt()
  standardWorkMinutes?: number;

  @IsOptional()
  @IsInt()
  lateGraceMinutes?: number;

  @IsOptional()
  @Matches(HHMM)
  flexStartFrom?: string;

  @IsOptional()
  @Matches(HHMM)
  flexStartTo?: string;

  @IsOptional()
  @IsBoolean()
  ipRestricted?: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateWorkPolicyDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsIn([...WORK_POLICY_TYPES])
  type: string;

  @ValidateNested()
  @Type(() => WorkPolicyVersionInput)
  version: WorkPolicyVersionInput;
}

export class AddWorkPolicyVersionDto extends WorkPolicyVersionInput {
  @IsString()
  @MinLength(1)
  declare reason: string;
}
