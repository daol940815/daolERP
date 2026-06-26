"use client";

import DataManager, { ColumnDef, FieldDef } from "@/components/DataManager";

const columns: ColumnDef[] = [
  { key: "useDate", label: "이용일자", type: "date" },
  { key: "cardNo", label: "카드" },
  { key: "userName", label: "사용자" },
  { key: "merchant", label: "가맹점" },
  { key: "saleType", label: "구분" },
  { key: "amount", label: "승인금액", type: "won" },
  { key: "amountUsd", label: "USD", type: "usd" },
  { key: "status", label: "상태" },
  { key: "category", label: "회계분류" },
];

const fields: FieldDef[] = [
  { key: "useDate", label: "이용일자", type: "date" },
  { key: "rawUseDate", label: "원본 이용일시(텍스트)", placeholder: "11.19 00:31" },
  {
    key: "domestic",
    label: "국내/해외",
    type: "select",
    options: [
      { value: "국내", label: "국내" },
      { value: "해외", label: "해외" },
    ],
  },
  { key: "approvalNo", label: "승인번호" },
  { key: "cardNo", label: "이용카드(뒤 4자리)", placeholder: "3712" },
  { key: "userName", label: "사용자명", required: true },
  { key: "merchant", label: "이용가맹점명", full: true },
  { key: "content", label: "사용 내용", full: true },
  {
    key: "saleType",
    label: "매출구분",
    type: "select",
    options: [
      { value: "일시불", label: "일시불" },
      { value: "할부", label: "할부" },
    ],
  },
  { key: "installment", label: "할부개월" },
  { key: "amount", label: "승인금액/취소(원)", type: "won" },
  { key: "amountUsd", label: "승인금액(USD)", type: "usd" },
  {
    key: "status",
    label: "접수/취소",
    type: "select",
    options: [
      { value: "접수", label: "접수" },
      { value: "취소", label: "취소" },
    ],
  },
  { key: "category", label: "회계분류(계정과목)" },
];

export default function CardPage() {
  return (
    <DataManager
      title="법인카드 사용내역"
      description="우리카드 및 기타지출 — 사용내역 입력·조회"
      apiPath="/api/cards"
      columns={columns}
      fields={fields}
      searchPlaceholder="가맹점·사용자·카드 검색"
      sumKeys={["amount"]}
    />
  );
}
