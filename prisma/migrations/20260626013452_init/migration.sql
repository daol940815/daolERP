-- CreateTable
CREATE TABLE "TaxInvoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "direction" TEXT NOT NULL,
    "taxType" TEXT NOT NULL,
    "monthCode" TEXT,
    "seq" INTEGER,
    "writeDate" DATETIME,
    "issueDate" DATETIME,
    "bizNo" TEXT,
    "partner" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "supplyAmount" INTEGER NOT NULL DEFAULT 0,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "item" TEXT,
    "paymentDate" DATETIME,
    "receiptType" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CardUsage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "useDate" DATETIME,
    "rawUseDate" TEXT,
    "domestic" TEXT,
    "approvalNo" TEXT,
    "cardNo" TEXT,
    "userName" TEXT,
    "merchant" TEXT,
    "content" TEXT,
    "saleType" TEXT,
    "installment" TEXT,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "amountUsd" REAL NOT NULL DEFAULT 0,
    "status" TEXT,
    "category" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "account" TEXT NOT NULL,
    "txAt" DATETIME,
    "rawTxAt" TEXT,
    "summary" TEXT,
    "description" TEXT,
    "withdrawal" INTEGER NOT NULL DEFAULT 0,
    "deposit" INTEGER NOT NULL DEFAULT 0,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "branch" TEXT,
    "memo" TEXT,
    "category" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "TaxInvoice_direction_taxType_idx" ON "TaxInvoice"("direction", "taxType");

-- CreateIndex
CREATE INDEX "TaxInvoice_issueDate_idx" ON "TaxInvoice"("issueDate");

-- CreateIndex
CREATE INDEX "TaxInvoice_partner_idx" ON "TaxInvoice"("partner");

-- CreateIndex
CREATE INDEX "CardUsage_useDate_idx" ON "CardUsage"("useDate");

-- CreateIndex
CREATE INDEX "CardUsage_userName_idx" ON "CardUsage"("userName");

-- CreateIndex
CREATE INDEX "CardUsage_cardNo_idx" ON "CardUsage"("cardNo");

-- CreateIndex
CREATE INDEX "BankTransaction_account_idx" ON "BankTransaction"("account");

-- CreateIndex
CREATE INDEX "BankTransaction_txAt_idx" ON "BankTransaction"("txAt");
