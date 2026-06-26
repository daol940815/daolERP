import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseWorkbook } from "@/lib/excel-import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const replace = form.get("replace") === "true";

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseWorkbook(buffer);

    // 트랜잭션으로 안전하게 적재
    const inserted = await prisma.$transaction(async (tx) => {
      if (replace) {
        if (parsed.invoices.length) await tx.taxInvoice.deleteMany({});
        if (parsed.cards.length) await tx.cardUsage.deleteMany({});
        if (parsed.bank.length) await tx.bankTransaction.deleteMany({});
        if (parsed.sales.length) await tx.salesDeal.deleteMany({});
      }
      let inv = 0,
        card = 0,
        bank = 0,
        sales = 0;
      if (parsed.invoices.length) {
        const r = await tx.taxInvoice.createMany({ data: parsed.invoices });
        inv = r.count;
      }
      if (parsed.cards.length) {
        const r = await tx.cardUsage.createMany({ data: parsed.cards });
        card = r.count;
      }
      if (parsed.bank.length) {
        const r = await tx.bankTransaction.createMany({ data: parsed.bank });
        bank = r.count;
      }
      if (parsed.sales.length) {
        const r = await tx.salesDeal.createMany({ data: parsed.sales });
        sales = r.count;
      }
      return { inv, card, bank, sales };
    });

    return NextResponse.json({
      ok: true,
      replace,
      counts: inserted,
      summary: parsed.summary,
      warnings: parsed.warnings,
    });
  } catch (e) {
    console.error("import error", e);
    return NextResponse.json(
      { error: "엑셀을 처리하는 중 오류가 발생했습니다. 파일 형식을 확인해주세요." },
      { status: 500 }
    );
  }
}
