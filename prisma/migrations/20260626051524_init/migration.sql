-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxInvoice" (
    "id" SERIAL NOT NULL,
    "direction" TEXT NOT NULL,
    "taxType" TEXT NOT NULL,
    "monthCode" TEXT,
    "seq" INTEGER,
    "writeDate" TIMESTAMP(3),
    "issueDate" TIMESTAMP(3),
    "bizNo" TEXT,
    "partner" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "supplyAmount" INTEGER NOT NULL DEFAULT 0,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "item" TEXT,
    "paymentDate" TIMESTAMP(3),
    "receiptType" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesDeal" (
    "id" SERIAL NOT NULL,
    "dealDate" TIMESTAMP(3),
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
    "invoiceDate" TIMESTAMP(3),
    "paymentDate" TIMESTAMP(3),
    "paymentAmount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardUsage" (
    "id" SERIAL NOT NULL,
    "useDate" TIMESTAMP(3),
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
    "amountUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" SERIAL NOT NULL,
    "account" TEXT NOT NULL,
    "txAt" TIMESTAMP(3),
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "TaxInvoice_direction_taxType_idx" ON "TaxInvoice"("direction", "taxType");

-- CreateIndex
CREATE INDEX "TaxInvoice_issueDate_idx" ON "TaxInvoice"("issueDate");

-- CreateIndex
CREATE INDEX "TaxInvoice_partner_idx" ON "TaxInvoice"("partner");

-- CreateIndex
CREATE INDEX "SalesDeal_stage_idx" ON "SalesDeal"("stage");

-- CreateIndex
CREATE INDEX "SalesDeal_dealDate_idx" ON "SalesDeal"("dealDate");

-- CreateIndex
CREATE INDEX "SalesDeal_customerName_idx" ON "SalesDeal"("customerName");

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
