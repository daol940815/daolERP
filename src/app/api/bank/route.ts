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
  const account = sp.get("account") ?? undefined;
  const q = sp.get("q")?.trim();

  const where: Record<string, unknown> = {};
  if (account) where.account = account;
  if (q) {
    where.OR = [
      { summary: { contains: q } },
      { description: { contains: q } },
      { memo: { contains: q } },
      { category: { contains: q } },
    ];
  }

  const rows = await prisma.bankTransaction.findMany({
    where,
    orderBy: [{ txAt: "desc" }, { id: "desc" }],
    take: 2000,
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const created = await prisma.bankTransaction.create({
    data: {
      account: b.account === "WITHDRAWAL" ? "WITHDRAWAL" : "DEPOSIT",
      txAt: parseDate(b.txAt),
      rawTxAt: b.rawTxAt || null,
      summary: b.summary || null,
      description: b.description || null,
      withdrawal: parseWon(b.withdrawal),
      deposit: parseWon(b.deposit),
      balance: parseWon(b.balance),
      branch: b.branch || null,
      memo: b.memo || null,
      category: b.category || null,
      note: b.note || null,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
