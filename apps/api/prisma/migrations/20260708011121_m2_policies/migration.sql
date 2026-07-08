-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "leave_policy_id" INTEGER,
ADD COLUMN     "work_policy_id" INTEGER;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "leave_policy_id" INTEGER,
ADD COLUMN     "work_policy_id" INTEGER;

-- CreateTable
CREATE TABLE "work_policies" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_policy_versions" (
    "id" SERIAL NOT NULL,
    "work_policy_id" INTEGER NOT NULL,
    "effective_date" DATE NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "break_minutes" INTEGER NOT NULL DEFAULT 60,
    "standard_work_minutes" INTEGER NOT NULL DEFAULT 480,
    "late_grace_minutes" INTEGER NOT NULL DEFAULT 0,
    "flex_start_from" TEXT,
    "flex_start_to" TEXT,
    "ip_restricted" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_policies" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "grant_basis" TEXT NOT NULL DEFAULT 'HIRE_DATE',
    "fiscal_start_month" INTEGER NOT NULL DEFAULT 1,
    "expire_months" INTEGER NOT NULL DEFAULT 12,
    "carry_over" BOOLEAN NOT NULL DEFAULT false,
    "carry_over_limit" INTEGER,
    "auto_expire" BOOLEAN NOT NULL DEFAULT true,
    "promotion_days" INTEGER[] DEFAULT ARRAY[60, 30]::INTEGER[],
    "min_unit" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paid_type" TEXT NOT NULL DEFAULT 'PAID',
    "deducts_annual" BOOLEAN NOT NULL DEFAULT false,
    "attachment_rule" TEXT NOT NULL DEFAULT 'NONE',
    "allow_half_day" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "holiday_type" TEXT NOT NULL,
    "department_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_policy_versions_work_policy_id_effective_date_idx" ON "work_policy_versions"("work_policy_id", "effective_date");

-- CreateIndex
CREATE UNIQUE INDEX "work_policy_versions_work_policy_id_effective_date_key" ON "work_policy_versions"("work_policy_id", "effective_date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_code_key" ON "leave_types"("code");

-- CreateIndex
CREATE INDEX "holidays_date_idx" ON "holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_department_id_key" ON "holidays"("date", "department_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_work_policy_id_fkey" FOREIGN KEY ("work_policy_id") REFERENCES "work_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_leave_policy_id_fkey" FOREIGN KEY ("leave_policy_id") REFERENCES "leave_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_work_policy_id_fkey" FOREIGN KEY ("work_policy_id") REFERENCES "work_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_leave_policy_id_fkey" FOREIGN KEY ("leave_policy_id") REFERENCES "leave_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_policy_versions" ADD CONSTRAINT "work_policy_versions_work_policy_id_fkey" FOREIGN KEY ("work_policy_id") REFERENCES "work_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
