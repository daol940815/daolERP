import { IsDateString, IsIn, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { HOLIDAY_TYPES } from '@daolerp/shared';

export class HolidayInput {
  @IsDateString()
  date: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsIn([...HOLIDAY_TYPES])
  holidayType: string;

  /** null/미지정 = 전사, 값 = 특정 부서만 (기획서 HOL-02) */
  @IsOptional()
  @IsInt()
  departmentId?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
