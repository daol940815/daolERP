import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { LEAVE_GRANT_BASIS } from '@daolerp/shared';

export class LeavePolicyInput {
  @IsString()
  @MinLength(1)
  name: string;

  @IsIn([...LEAVE_GRANT_BASIS])
  grantBasis: string;

  @IsInt()
  @Min(1)
  @Max(12)
  fiscalStartMonth = 1;

  @IsInt()
  @Min(1)
  expireMonths = 12;

  @IsBoolean()
  carryOver = false;

  @IsOptional()
  @IsInt()
  carryOverLimit?: number;

  @IsBoolean()
  autoExpire = true;

  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  promotionDays: number[] = [60, 30];

  @IsIn([1, 0.5, 0.25])
  minUnit = 0.5;

  @IsBoolean()
  isActive = true;

  @IsOptional()
  @IsString()
  reason?: string;
}
