-- CreateTable
CREATE TABLE "SalesDeal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dealDate" DATETIME,
    "stage" TEXT NOT NULL DEFAULT '견적',
    "category" TEXT,
    "introducer" TEXT,
    "customerOwner" TEXT,
    "customerName" TEXT,
    "finalCustomer" TEXT,
    "finalOwner" TEXT,
    "title" TEXT,
    "model" TEXT,
    "relatedInfo" TEXT,
    "channel" TEXT,
    "purchasePrice" INTEGER NOT NULL DEFAULT 0,
    "salesPrice" INTEGER NOT NULL DEFAULT 0,
    "margin" INTEGER NOT NULL DEFAULT 0,
    "commission" INTEGER NOT NULL DEFAULT 0,
    "operatingProfit" INTEGER NOT NULL DEFAULT 0,
    "invoiceIssuer" TEXT,
    "invoiceDate" DATETIME,
    "paymentDate" DATETIME,
    "paymentAmount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "SalesDeal_stage_idx" ON "SalesDeal"("stage");

-- CreateIndex
CREATE INDEX "SalesDeal_dealDate_idx" ON "SalesDeal"("dealDate");

-- CreateIndex
CREATE INDEX "SalesDeal_customerName_idx" ON "SalesDeal"("customerName");
