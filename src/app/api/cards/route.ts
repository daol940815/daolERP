import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseWon } from "@/lib/format";

export const dynamic = "force-dynamic";

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  const user = sp.get("user")?.trim();

  const where: Record<string, unknown> = {};
  if (user) where.userName = user;
  if (q) {
    where.OR = [
      { merchant: { contains: q } },
      { content: { contains: q } },
      { userName: { contains: q } },
      { cardNo: { contains: q } },
    ];
  }

  const rows = await prisma.cardUsage.findMany({
    where,
    orderBy: [{ useDate: "desc" }, { id: "desc" }],
    take: 2000,
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const created = await prisma.cardUsage.create({
    data: {
      useDate: parseDate(b.useDate),
      rawUseDate: b.rawUseDate || null,
      domestic: b.domestic || null,
      approvalNo: b.approvalNo || null,
      cardNo: b.cardNo || null,
      userName: b.userName || null,
      merchant: b.merchant || null,
      content: b.content || null,
      saleType: b.saleType || null,
      installment: b.installment || null,
      amount: parseWon(b.amount),
      amountUsd: b.amountUsd ? Number(b.amountUsd) : 0,
      status: b.status || null,
      category: b.category || null,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
