"use client";

import DataManager, { ColumnDef, FieldDef } from "@/components/DataManager";

const columns: ColumnDef[] = [
  { key: "monthCode", label: "월" },
  { key: "issueDate", label: "발행일", type: "date" },
  { key: "bizNo", label: "사업자번호" },
  { key: "partner", label: "매입처" },
  { key: "item", label: "품명" },
  { key: "total", label: "합계", type: "won" },
  { key: "supplyAmount", label: "공급가액", type: "won" },
  { key: "tax", label: "세액", type: "won" },
  { key: "receiptType", label: "영수/청구" },
  { key: "note", label: "비고" },
];

const fields: FieldDef[] = [
  {
    key: "taxType",
    label: "과세구분",
    type: "select",
    options: [
      { value: "TAXABLE", label: "과세" },
      { value: "TAX_FREE", label: "면세" },
    ],
    required: true,
  },
  { key: "monthCode", label: "월 (예: 2403)", placeholder: "2403" },
  { key: "seq", label: "번호", type: "number" },
  { key: "writeDate", label: "작성일", type: "date" },
  { key: "issueDate", label: "발행일", type: "date" },
  { key: "bizNo", label: "사업자번호", placeholder: "000-00-00000" },
  { key: "partner", label: "매입처", required: true },
  { key: "total", label: "합계", type: "won" },
  { key: "supplyAmount", label: "공급가액", type: "won" },
  { key: "tax", label: "세액", type: "won" },
  { key: "paymentDate", label: "입금일", type: "date" },
  {
    key: "receiptType",
    label: "영수/청구",
    type: "select",
    options: [
      { value: "영수", label: "영수" },
      { value: "청구", label: "청구" },
    ],
  },
  { key: "item", label: "품명", full: true },
  { key: "note", label: "비고", full: true },
];

export default function PurchaseInvoicePage() {
  return (
    <DataManager
      title="매입 세금계산서"
      description="매입(과세/면세) 세금계산서 입력·조회"
      apiPath="/api/invoices"
      query={{ direction: "PURCHASE" }}
      columns={columns}
      fields={fields}
      searchPlaceholder="매입처·품명·사업자번호 검색"
      sumKeys={["total", "supplyAmount", "tax"]}
    />
  );
}
