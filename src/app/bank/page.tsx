"use client";

import { useState } from "react";
import DataManager, { ColumnDef, FieldDef } from "@/components/DataManager";
import { BANK_ACCOUNT, BANK_ACCOUNT_NUMBERS, BankAccount } from "@/lib/constants";

const columns: ColumnDef[] = [
  { key: "txAt", label: "거래일시", type: "date" },
  { key: "summary", label: "적요" },
  { key: "description", label: "기재내용" },
  { key: "withdrawal", label: "지급(출금)", type: "won" },
  { key: "deposit", label: "입금", type: "won" },
  { key: "balance", label: "거래후잔액", type: "won" },
  { key: "category", label: "계정" },
  { key: "memo", label: "메모" },
];

function fields(account: BankAccount): FieldDef[] {
  return [
    {
      key: "account",
      label: "통장구분",
      type: "select",
      options: [
        { value: "DEPOSIT", label: "입금통장" },
        { value: "WITHDRAWAL", label: "출금통장" },
      ],
      required: true,
    },
    { key: "txAt", label: "거래일시", type: "date" },
    { key: "rawTxAt", label: "원본 거래일시(텍스트)", placeholder: "2024.03.16 08:14:54" },
    { key: "summary", label: "적요" },
    { key: "description", label: "기재내용" },
    { key: "withdrawal", label: "지급(원)", type: "won" },
    { key: "deposit", label: "입금(원)", type: "won" },
    { key: "balance", label: "거래후 잔액(원)", type: "won" },
    { key: "branch", label: "취급점" },
    { key: "category", label: "계정(회계분류)" },
    { key: "memo", label: "메모", full: true },
    { key: "note", label: "비고", full: true },
  ];
}

export default function BankPage() {
  const [account, setAccount] = useState<BankAccount>("DEPOSIT");

  return (
    <div className="space-y-4">
      <div className="mx-auto flex max-w-7xl items-center gap-2">
        {(Object.keys(BANK_ACCOUNT) as BankAccount[]).map((acc) => (
          <button
            key={acc}
            onClick={() => setAccount(acc)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              account === acc
                ? "bg-brand text-white"
                : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {BANK_ACCOUNT[acc]}{" "}
            <span className="text-xs opacity-70">{BANK_ACCOUNT_NUMBERS[acc]}</span>
          </button>
        ))}
      </div>

      <DataManager
        key={account}
        title={`통장 입출금 — ${BANK_ACCOUNT[account]}`}
        description={`계좌번호 ${BANK_ACCOUNT_NUMBERS[account]}`}
        apiPath="/api/bank"
        query={{ account }}
        columns={columns}
        fields={fields(account)}
        searchPlaceholder="적요·기재내용·메모 검색"
        sumKeys={["withdrawal", "deposit"]}
      />
    </div>
  );
}
