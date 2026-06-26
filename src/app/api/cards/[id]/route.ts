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
  const updated = await prisma.cardUsage.update({
    where: { id },
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
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  await prisma.cardUsage.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
