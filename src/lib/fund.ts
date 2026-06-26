import { prisma } from "./prisma";

// ─────────────────────────────────────────────────────────
// 자금현황 집계 계산
// 엑셀 "자금현황 집계 (자금 집계표)" 를 DB 데이터로 자동 산출
// ─────────────────────────────────────────────────────────

export interface FundSummary {
  // 통장 현재 잔고 (각 통장의 최신 거래후잔액)
  balance: {
    deposit: number;
    withdrawal: number;
    total: number;
    depositAsOf: Date | null;
    withdrawalAsOf: Date | null;
  };
  // 가수금 현황 (이정철 대표)
  gasugeum: {
    inflow: number; // 가수금 입금 누계
    refund: number; // 가수금 반환 누계
    net: number; // 가수금 잔금
    count: number;
  };
  // 손익 요약 (세금계산서 기준)
  pnl: {
    salesTotal: number;
    salesSupply: number;
    salesTax: number;
    salesCount: number;
    purchaseTotal: number;
    purchaseSupply: number;
    purchaseTax: number;
    purchaseCount: number;
    grossProfit: number; // 매출공급가 - 매입공급가
    cardTotal: number;
    cardCount: number;
  };
  // 통장 입출금 누계
  bankFlow: {
    totalDeposit: number;
    totalWithdrawal: number;
    net: number;
  };
  // 연도별 매출·매입·이익
  byYear: { year: string; sales: number; purchase: number; profit: number }[];
  // 월별 통장 입출금 (최근 12개월)
  byMonth: { ym: string; deposit: number; withdrawal: number }[];
  hasData: boolean;
}

const GASU_WHERE = {
  OR: [
    { category: { contains: "가수금" } },
    { category: { contains: "가지급" } },
    { memo: { contains: "가수금" } },
    { memo: { contains: "가지급" } },
  ],
};

function yearOf(d: Date | null): string | null {
  if (!d) return null;
  return String(new Date(d).getFullYear());
}
function ymOf(d: Date | null): string | null {
  if (!d) return null;
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

export async function getFundSummary(): Promise<FundSummary> {
  const [
    lastDeposit,
    lastWithdrawal,
    gasuRows,
    salesAgg,
    purchaseAgg,
    cardAgg,
    cardCount,
    depFlow,
    wdFlow,
    invoices,
    bankTx,
    bankCount,
  ] = await Promise.all([
    prisma.bankTransaction.findFirst({
      where: { account: "DEPOSIT" },
      orderBy: [{ txAt: "desc" }, { id: "desc" }],
    }),
    prisma.bankTransaction.findFirst({
      where: { account: "WITHDRAWAL" },
      orderBy: [{ txAt: "desc" }, { id: "desc" }],
    }),
    prisma.bankTransaction.findMany({
      where: GASU_WHERE,
      select: { deposit: true, withdrawal: true },
    }),
    prisma.taxInvoice.aggregate({
      where: { direction: "SALES" },
      _sum: { total: true, supplyAmount: true, tax: true },
      _count: true,
    }),
    prisma.taxInvoice.aggregate({
      where: { direction: "PURCHASE" },
      _sum: { total: true, supplyAmount: true, tax: true },
      _count: true,
    }),
    prisma.cardUsage.aggregate({ _sum: { amount: true } }),
    prisma.cardUsage.count(),
    prisma.bankTransaction.aggregate({
      where: { account: "DEPOSIT" },
      _sum: { deposit: true, withdrawal: true },
    }),
    prisma.bankTransaction.aggregate({
      where: { account: "WITHDRAWAL" },
      _sum: { deposit: true, withdrawal: true },
    }),
    prisma.taxInvoice.findMany({
      select: { direction: true, supplyAmount: true, total: true, issueDate: true },
    }),
    prisma.bankTransaction.findMany({
      select: { txAt: true, deposit: true, withdrawal: true },
    }),
    prisma.bankTransaction.count(),
  ]);

  // 가수금
  let gIn = 0,
    gOut = 0;
  for (const r of gasuRows) {
    gIn += r.deposit;
    gOut += r.withdrawal;
  }

  // 연도별 매출/매입
  const yearMap = new Map<string, { sales: number; purchase: number }>();
  for (const inv of invoices) {
    const y = yearOf(inv.issueDate) ?? "미지정";
    if (!yearMap.has(y)) yearMap.set(y, { sales: 0, purchase: 0 });
    const e = yearMap.get(y)!;
    if (inv.direction === "SALES") e.sales += inv.supplyAmount;
    else e.purchase += inv.supplyAmount;
  }
  const byYear = Array.from(yearMap.entries())
    .map(([year, v]) => ({
      year,
      sales: v.sales,
      purchase: v.purchase,
      profit: v.sales - v.purchase,
    }))
    .sort((a, b) => a.year.localeCompare(b.year));

  // 월별 통장 입출금
  const monthMap = new Map<string, { deposit: number; withdrawal: number }>();
  for (const t of bankTx) {
    const ym = ymOf(t.txAt);
    if (!ym) continue;
    if (!monthMap.has(ym)) monthMap.set(ym, { deposit: 0, withdrawal: 0 });
    const e = monthMap.get(ym)!;
    e.deposit += t.deposit;
    e.withdrawal += t.withdrawal;
  }
  const byMonth = Array.from(monthMap.entries())
    .map(([ym, v]) => ({ ym, ...v }))
    .sort((a, b) => a.ym.localeCompare(b.ym))
    .slice(-12);

  const balDeposit = lastDeposit?.balance ?? 0;
  const balWithdrawal = lastWithdrawal?.balance ?? 0;

  const salesSupply = salesAgg._sum.supplyAmount ?? 0;
  const purchaseSupply = purchaseAgg._sum.supplyAmount ?? 0;

  return {
    balance: {
      deposit: balDeposit,
      withdrawal: balWithdrawal,
      total: balDeposit + balWithdrawal,
      depositAsOf: lastDeposit?.txAt ?? null,
      withdrawalAsOf: lastWithdrawal?.txAt ?? null,
    },
    gasugeum: { inflow: gIn, refund: gOut, net: gIn - gOut, count: gasuRows.length },
    pnl: {
      salesTotal: salesAgg._sum.total ?? 0,
      salesSupply,
      salesTax: salesAgg._sum.tax ?? 0,
      salesCount: salesAgg._count,
      purchaseTotal: purchaseAgg._sum.total ?? 0,
      purchaseSupply,
      purchaseTax: purchaseAgg._sum.tax ?? 0,
      purchaseCount: purchaseAgg._count,
      grossProfit: salesSupply - purchaseSupply,
      cardTotal: cardAgg._sum.amount ?? 0,
      cardCount,
    },
    bankFlow: {
      totalDeposit: (depFlow._sum.deposit ?? 0) + (wdFlow._sum.deposit ?? 0),
      totalWithdrawal: (depFlow._sum.withdrawal ?? 0) + (wdFlow._sum.withdrawal ?? 0),
      net:
        (depFlow._sum.deposit ?? 0) +
        (wdFlow._sum.deposit ?? 0) -
        (depFlow._sum.withdrawal ?? 0) -
        (wdFlow._sum.withdrawal ?? 0),
    },
    byYear,
    byMonth,
    hasData: salesAgg._count + purchaseAgg._count + cardCount + bankCount > 0,
  };
}
