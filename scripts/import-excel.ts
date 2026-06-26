/**
 * 엑셀 일괄 가져오기 스크립트 (커맨드라인)
 * 사용법:  npm run import:excel -- "/경로/파일.xlsx"
 * 옵션:   --append  (기존 데이터를 비우지 않고 추가)
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { parseWorkbook } from "../src/lib/excel-import";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const append = args.includes("--append");
  const path = args.find((a) => !a.startsWith("--"));
  if (!path) {
    console.error('사용법: npm run import:excel -- "/경로/파일.xlsx" [--append]');
    process.exit(1);
  }

  console.log(`엑셀 읽는 중: ${path}`);
  const buf = readFileSync(path);
  const parsed = parseWorkbook(buf);

  console.log("\n── 분석 결과 ──");
  for (const s of parsed.summary) {
    console.log(`  ${s.sheet.padEnd(16)} ${s.type.padEnd(12)} ${s.count}건`);
  }
  for (const w of parsed.warnings) console.log(`  ⚠ ${w}`);

  if (!append) {
    console.log("\n기존 데이터 삭제 중...");
    await prisma.taxInvoice.deleteMany({});
    await prisma.cardUsage.deleteMany({});
    await prisma.bankTransaction.deleteMany({});
  }

  console.log("저장 중...");
  if (parsed.invoices.length)
    await prisma.taxInvoice.createMany({ data: parsed.invoices });
  if (parsed.cards.length)
    await prisma.cardUsage.createMany({ data: parsed.cards });
  if (parsed.bank.length)
    await prisma.bankTransaction.createMany({ data: parsed.bank });

  console.log(
    `\n✅ 완료: 세금계산서 ${parsed.invoices.length}건 / 카드 ${parsed.cards.length}건 / 통장 ${parsed.bank.length}건`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
