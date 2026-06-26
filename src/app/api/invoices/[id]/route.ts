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
  const updated = await prisma.taxInvoice.update({
    where: { id },
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
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  await prisma.taxInvoice.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
