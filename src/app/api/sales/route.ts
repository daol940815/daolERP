import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseWon } from "@/lib/format";

export const dynamic = "force-dynamic";

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

function buildData(b: any) {
  return {
    dealDate: parseDate(b.dealDate),
    stage: b.stage || "견적",
    category: b.category || null,
    introducer: b.introducer || null,
    customerOwner: b.customerOwner || null,
    customerName: b.customerName || null,
    finalCustomer: b.finalCustomer || null,
    finalOwner: b.finalOwner || null,
    title: b.title || null,
    model: b.model || null,
    relatedInfo: b.relatedInfo || null,
    channel: b.channel || null,
    purchasePrice: parseWon(b.purchasePrice),
    salesPrice: parseWon(b.salesPrice),
    margin: parseWon(b.margin),
    commission: parseWon(b.commission),
    operatingProfit: parseWon(b.operatingProfit),
    invoiceIssuer: b.invoiceIssuer || null,
    invoiceDate: parseDate(b.invoiceDate),
    paymentDate: parseDate(b.paymentDate),
    paymentAmount: parseWon(b.paymentAmount),
    note: b.note || null,
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const stage = sp.get("stage")?.trim();
  const q = sp.get("q")?.trim();

  const where: Record<string, unknown> = {};
  if (stage && stage !== "ALL") where.stage = stage;
  if (q) {
    where.OR = [
      { customerName: { contains: q } },
      { finalCustomer: { contains: q } },
      { title: { contains: q } },
      { model: { contains: q } },
      { introducer: { contains: q } },
      { note: { contains: q } },
    ];
  }

  const rows = await prisma.salesDeal.findMany({
    where,
    orderBy: [{ dealDate: "desc" }, { id: "desc" }],
    take: 2000,
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const created = await prisma.salesDeal.create({ data: buildData(b) });
  return NextResponse.json(created, { status: 201 });
}
