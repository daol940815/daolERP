import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseWon } from "@/lib/format";

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  const b = await req.json();
  const updated = await prisma.bankTransaction.update({
    where: { id },
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
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  await prisma.bankTransaction.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
