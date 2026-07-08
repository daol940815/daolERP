-- CreateTable
CREATE TABLE "attendance_events" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "is_correction" BOOLEAN NOT NULL DEFAULT false,
    "correction_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_corrections" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "clock_in" TEXT,
    "clock_out" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" SERIAL NOT NULL,
    "ref_type" TEXT,
    "ref_id" INTEGER,
    "file_name" TEXT NOT NULL,
    "stored_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaded_by" INTEGER NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_events_employee_id_occurred_at_idx" ON "attendance_events"("employee_id", "occurred_at");

-- CreateIndex
CREATE INDEX "attendance_corrections_employee_id_date_idx" ON "attendance_corrections"("employee_id", "date");

-- CreateIndex
CREATE INDEX "attachments_ref_type_ref_id_idx" ON "attachments"("ref_type", "ref_id");

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_correction_id_fkey" FOREIGN KEY ("correction_id") REFERENCES "attendance_corrections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
