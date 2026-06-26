import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatWon } from "@/lib/format";

export const dynamic = "force-dynamic";

async function getStats() {
  const [salesAgg, purchaseAgg, cardAgg, cardCount, depositAgg, withdrawalAgg, invoiceCount, bankCount] =
    await Promise.all([
      prisma.taxInvoice.aggregate({
        where: { direction: "SALES" },
        _sum: { total: true },
        _count: true,
      }),
      prisma.taxInvoice.aggregate({
        where: { direction: "PURCHASE" },
        _sum: { total: true },
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
      prisma.taxInvoice.count(),
      prisma.bankTransaction.count(),
    ]);

  return {
    salesTotal: salesAgg._sum.total ?? 0,
    salesCount: salesAgg._count,
    purchaseTotal: purchaseAgg._sum.total ?? 0,
    purchaseCount: purchaseAgg._count,
    cardTotal: cardAgg._sum.amount ?? 0,
    cardCount,
    depositIn: depositAgg._sum.deposit ?? 0,
    withdrawalOut: withdrawalAgg._sum.withdrawal ?? 0,
    invoiceCount,
    bankCount,
  };
}

function Card({
  title,
  value,
  sub,
  href,
  accent,
}: {
  title: string;
  value: string;
  sub?: string;
  href: string;
  accent: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
    >
      <div className="text-sm font-medium text-slate-500">{title}</div>
      <div className={`mt-2 text-2xl font-bold ${accent}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </Link>
  );
}

export default async function HomePage() {
  const s = await getStats();
  const empty = s.invoiceCount === 0 && s.cardCount === 0 && s.bankCount === 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">대시보드</h1>
        <p className="mt-1 text-sm text-slate-500">
          (주)스피어스 자회사 종합관리 — 로우데이터 현황 요약
        </p>
      </div>

      {empty && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <div className="font-semibold text-amber-800">
            아직 등록된 데이터가 없습니다.
          </div>
          <p className="mt-1 text-sm text-amber-700">
            기존 엑셀 파일이 있다면{" "}
            <Link href="/import" className="font-semibold underline">
              엑셀 가져오기
            </Link>{" "}
            에서 한 번에 불러올 수 있습니다. 또는 각 메뉴에서 직접 입력하세요.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          title="매출 세금계산서 합계"
          value={`${formatWon(s.salesTotal)} 원`}
          sub={`${s.salesCount}건`}
          href="/invoices/sales"
          accent="text-blue-600"
        />
        <Card
          title="매입 세금계산서 합계"
          value={`${formatWon(s.purchaseTotal)} 원`}
          sub={`${s.purchaseCount}건`}
          href="/invoices/purchase"
          accent="text-violet-600"
        />
        <Card
          title="카드 사용액 합계"
          value={`${formatWon(s.cardTotal)} 원`}
          sub={`${s.cardCount}건`}
          href="/cards"
          accent="text-rose-600"
        />
        <Card
          title="입금통장 총 입금"
          value={`${formatWon(s.depositIn)} 원`}
          sub="입금통장 기준"
          href="/bank"
          accent="text-emerald-600"
        />
        <Card
          title="출금통장 총 지급"
          value={`${formatWon(s.withdrawalOut)} 원`}
          sub="출금통장 기준"
          href="/bank"
          accent="text-orange-600"
        />
        <Card
          title="통장 거래 건수"
          value={`${formatWon(s.bankCount)} 건`}
          sub="입금+출금 통장"
          href="/bank"
          accent="text-slate-700"
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-700">빠른 시작</h2>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-600">
          <li>왼쪽 메뉴에서 매출/매입 계산서, 카드 사용내역, 통장 입출금을 입력·조회할 수 있습니다.</li>
          <li>기존 엑셀 데이터는 <Link href="/import" className="text-brand underline">엑셀 가져오기</Link>에서 업로드하면 자동으로 분류되어 저장됩니다.</li>
        </ul>
      </div>
    </div>
  );
}
