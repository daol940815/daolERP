-- CreateTable
CREATE TABLE "monthly_closings" (
    "id" SERIAL NOT NULL,
    "year_month" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "validation_result" JSONB,
    "executed_by" INTEGER,
    "closed_at" TIMESTAMP(3),
    "reopen_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "closing_snapshots" (
    "id" SERIAL NOT NULL,
    "closing_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "emp_no" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "department_name" TEXT,
    "workday_count" INTEGER NOT NULL,
    "present_days" INTEGER NOT NULL,
    "absent_days" INTEGER NOT NULL,
    "late_count" INTEGER NOT NULL,
    "late_minutes" INTEGER NOT NULL,
    "early_leave_count" INTEGER NOT NULL,
    "incomplete_count" INTEGER NOT NULL,
    "leave_days" INTEGER NOT NULL,
    "work_minutes" INTEGER NOT NULL,
    "overtime_minutes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "closing_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "monthly_closings_year_month_key" ON "monthly_closings"("year_month");

-- CreateIndex
CREATE UNIQUE INDEX "closing_snapshots_closing_id_employee_id_key" ON "closing_snapshots"("closing_id", "employee_id");

-- AddForeignKey
ALTER TABLE "closing_snapshots" ADD CONSTRAINT "closing_snapshots_closing_id_fkey" FOREIGN KEY ("closing_id") REFERENCES "monthly_closings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
