-- AlterTable
ALTER TABLE "work_policy_versions" ADD COLUMN     "work_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[];

-- CreateTable
CREATE TABLE "shifts" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_schedules" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "is_workday" BOOLEAN NOT NULL,
    "planned_start" TEXT,
    "planned_end" TEXT,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "shift_id" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'AUTO',
    "work_policy_id" INTEGER,
    "adjust_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_lines" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "request_type" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_line_steps" (
    "id" SERIAL NOT NULL,
    "approval_line_id" INTEGER NOT NULL,
    "step_order" INTEGER NOT NULL,
    "approver_type" TEXT NOT NULL,
    "approver_employee_id" INTEGER,
    "approver_job_title_code" TEXT,

    CONSTRAINT "approval_line_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_line_assignments" (
    "id" SERIAL NOT NULL,
    "approval_line_id" INTEGER NOT NULL,
    "employee_id" INTEGER,
    "department_id" INTEGER,

    CONSTRAINT "approval_line_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" SERIAL NOT NULL,
    "request_type" TEXT NOT NULL,
    "request_id" INTEGER NOT NULL,
    "applicant_employee_id" INTEGER NOT NULL,
    "approval_line_id" INTEGER,
    "current_step" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_step_records" (
    "id" SERIAL NOT NULL,
    "approval_id" INTEGER NOT NULL,
    "step_order" INTEGER NOT NULL,
    "approver_employee_id" INTEGER,
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "approval_step_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_schedules_date_idx" ON "work_schedules"("date");

-- CreateIndex
CREATE UNIQUE INDEX "work_schedules_employee_id_date_key" ON "work_schedules"("employee_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "approval_line_steps_approval_line_id_step_order_key" ON "approval_line_steps"("approval_line_id", "step_order");

-- CreateIndex
CREATE INDEX "approval_line_assignments_employee_id_idx" ON "approval_line_assignments"("employee_id");

-- CreateIndex
CREATE INDEX "approval_line_assignments_department_id_idx" ON "approval_line_assignments"("department_id");

-- CreateIndex
CREATE INDEX "approvals_status_idx" ON "approvals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "approvals_request_type_request_id_key" ON "approvals"("request_type", "request_id");

-- CreateIndex
CREATE INDEX "approval_step_records_approver_employee_id_decision_idx" ON "approval_step_records"("approver_employee_id", "decision");

-- AddForeignKey
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_line_steps" ADD CONSTRAINT "approval_line_steps_approval_line_id_fkey" FOREIGN KEY ("approval_line_id") REFERENCES "approval_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_line_steps" ADD CONSTRAINT "approval_line_steps_approver_employee_id_fkey" FOREIGN KEY ("approver_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_line_assignments" ADD CONSTRAINT "approval_line_assignments_approval_line_id_fkey" FOREIGN KEY ("approval_line_id") REFERENCES "approval_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_line_assignments" ADD CONSTRAINT "approval_line_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_line_assignments" ADD CONSTRAINT "approval_line_assignments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_applicant_employee_id_fkey" FOREIGN KEY ("applicant_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approval_line_id_fkey" FOREIGN KEY ("approval_line_id") REFERENCES "approval_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_records" ADD CONSTRAINT "approval_step_records_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "approvals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_records" ADD CONSTRAINT "approval_step_records_approver_employee_id_fkey" FOREIGN KEY ("approver_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
