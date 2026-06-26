import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseWon } from "@/lib/format";

export const dynamic = "force-dynamic";

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

// 목록 조회: ?direction=SALES&taxType=TAXABLE&q=검색어
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const direction = sp.get("direction") ?? undefined;
  const taxType = sp.get("taxType") ?? undefined;
  const q = sp.get("q")?.trim();

  const where: Record<string, unknown> = {};
  if (direction) where.direction = direction;
  if (taxType) where.taxType = taxType;
  if (q) {
    where.OR = [
      { partner: { contains: q } },
      { item: { contains: q } },
      { bizNo: { contains: q } },
      { note: { contains: q } },
    ];
  }

  const rows = await prisma.taxInvoice.findMany({
    where,
    orderBy: [{ issueDate: "desc" }, { id: "desc" }],
    take: 1000,
  });
  return NextResponse.json(rows);
}

// 신규 등록
export async function POST(req: NextRequest) {
  const b = await req.json();
  const created = await prisma.taxInvoice.create({
    data: {
      direction: b.direction === "PURCHASE" ? "PURCHASE" : "SALES",
      taxType: b.taxType === "TAX_FREE" ? "TAX_FREE" : "TAXABLE",
      monthCode: b.monthCode || null,
      seq: b.seq != null && b.seq !== "" ? Number(b.seq) : null,
      writeDate: parseDate(b.writeDate),
      issueDate: parseDate(b.issueDate),
      bizNo: b.bizNo || null,
      partner: b.partner || null,
      total: parseWon(b.total),
      supplyAmount: parseWon(b.supplyAmount),
      tax: parseWon(b.tax),
      item: b.item || null,
      paymentDate: parseDate(b.paymentDate),
      receiptType: b.receiptType || null,
      note: b.note || null,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
