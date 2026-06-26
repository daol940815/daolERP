import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseWon } from "@/lib/format";

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

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  const b = await req.json();
  const updated = await prisma.salesDeal.update({ where: { id }, data: buildData(b) });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  await prisma.salesDeal.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
