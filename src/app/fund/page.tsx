import Link from "next/link";
import { getFundSummary } from "@/lib/fund";
import { formatWon, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  sub,
  accent = "text-slate-800",
  highlight = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight ? "border-brand/30 bg-blue-50/40" : "border-slate-200 bg-white"
      }`}
    >
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${accent}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-bold text-slate-700">{title}</h2>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export default async function FundPage() {
  const f = await getFundSummary();

  if (!f.hasData) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <h1 className="text-2xl font-bold text-slate-800">자금현황 대시보드</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-800">
          아직 데이터가 없습니다.{" "}
          <Link href="/import" className="font-semibold underline">
            엑셀 가져오기
          </Link>{" "}
          로 통장·계산서·카드 데이터를 먼저 불러오세요.
        </div>
      </div>
    );
  }

  const maxYear = Math.max(1, ...f.byYear.map((y) => Math.max(y.sales, y.purchase)));
  const maxMonth = Math.max(
    1,
    ...f.byMonth.map((m) => Math.max(m.deposit, m.withdrawal))
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">자금현황 대시보드</h1>
        <p className="mt-1 text-sm text-slate-500">
          통장·세금계산서·카드 데이터로 자동 집계한 (주)스피어스 자금 현황입니다.
        </p>
      </div>

      {/* 통장 잔고 + 가수금 */}
      <Section title="통장 현재 잔고" hint="각 통장의 가장 최근 거래후 잔액 기준">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="입금통장 잔고"
            value={`${formatWon(f.balance.deposit)} 원`}
            sub={f.balance.depositAsOf ? `${formatDate(f.balance.depositAsOf)} 기준` : undefined}
            accent="text-emerald-600"
          />
          <Stat
            label="출금통장 잔고"
            value={`${formatWon(f.balance.withdrawal)} 원`}
            sub={f.balance.withdrawalAsOf ? `${formatDate(f.balance.withdrawalAsOf)} 기준` : undefined}
            accent="text-orange-600"
          />
          <Stat
            label="통장 잔고 합계"
            value={`${formatWon(f.balance.total)} 원`}
            accent="text-slate-800"
            highlight
          />
          <Stat
            label="가수금 잔금 (이정철 대표)"
            value={`${formatWon(f.gasugeum.net)} 원`}
            sub={`입금 ${formatWon(f.gasugeum.inflow)} − 반환 ${formatWon(f.gasugeum.refund)}`}
            accent="text-violet-600"
            highlight
          />
        </div>
      </Section>

      {/* 손익 요약 */}
      <Section title="손익 요약" hint="세금계산서(공급가액) 기준">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="매출 (공급가액)"
            value={`${formatWon(f.pnl.salesSupply)} 원`}
            sub={`합계 ${formatWon(f.pnl.salesTotal)} · ${f.pnl.salesCount}건`}
            accent="text-blue-600"
          />
          <Stat
            label="매입 (공급가액)"
            value={`${formatWon(f.pnl.purchaseSupply)} 원`}
            sub={`합계 ${formatWon(f.pnl.purchaseTotal)} · ${f.pnl.purchaseCount}건`}
            accent="text-violet-600"
          />
          <Stat
            label="매출총이익 (매출−매입)"
            value={`${formatWon(f.pnl.grossProfit)} 원`}
            accent={f.pnl.grossProfit >= 0 ? "text-emerald-600" : "text-red-600"}
            highlight
          />
          <Stat
            label="카드 사용액"
            value={`${formatWon(f.pnl.cardTotal)} 원`}
            sub={`${f.pnl.cardCount}건`}
            accent="text-rose-600"
          />
        </div>
      </Section>

      {/* 통장 입출금 누계 */}
      <Section title="통장 입출금 누계" hint="입금·출금 통장 전체 합산">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="총 입금" value={`${formatWon(f.bankFlow.totalDeposit)} 원`} accent="text-emerald-600" />
          <Stat label="총 출금" value={`${formatWon(f.bankFlow.totalWithdrawal)} 원`} accent="text-orange-600" />
          <Stat
            label="순증감 (입금−출금)"
            value={`${formatWon(f.bankFlow.net)} 원`}
            accent={f.bankFlow.net >= 0 ? "text-emerald-600" : "text-red-600"}
            highlight
          />
        </div>
      </Section>

      {/* 연도별 매출·매입·이익 */}
      <Section title="연도별 매출·매입·이익" hint="세금계산서 발행일 기준 (공급가액)">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="space-y-4">
            {f.byYear.map((y) => (
              <div key={y.year}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-600">{y.year}</span>
                  <span className="text-slate-400">
                    이익{" "}
                    <span className={y.profit >= 0 ? "text-emerald-600" : "text-red-600"}>
                      {formatWon(y.profit)}
                    </span>{" "}
                    원
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-10 shrink-0 text-blue-600">매출</span>
                  <div className="h-3 flex-1 rounded bg-slate-100">
                    <div
                      className="h-3 rounded bg-blue-500"
                      style={{ width: `${(y.sales / maxYear) * 100}%` }}
                    />
                  </div>
                  <span className="w-28 shrink-0 text-right tabular-nums text-slate-500">
                    {formatWon(y.sales)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className="w-10 shrink-0 text-violet-600">매입</span>
                  <div className="h-3 flex-1 rounded bg-slate-100">
                    <div
                      className="h-3 rounded bg-violet-500"
                      style={{ width: `${(y.purchase / maxYear) * 100}%` }}
                    />
                  </div>
                  <span className="w-28 shrink-0 text-right tabular-nums text-slate-500">
                    {formatWon(y.purchase)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* 월별 통장 입출금 (최근 12개월) */}
      <Section title="월별 통장 입출금" hint="최근 12개월">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex min-w-[640px] items-end gap-3" style={{ height: 200 }}>
            {f.byMonth.map((m) => (
              <div key={m.ym} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-[150px] w-full items-end justify-center gap-1">
                  <div
                    className="w-1/2 rounded-t bg-emerald-400"
                    style={{ height: `${(m.deposit / maxMonth) * 100}%` }}
                    title={`입금 ${formatWon(m.deposit)}`}
                  />
                  <div
                    className="w-1/2 rounded-t bg-orange-400"
                    style={{ height: `${(m.withdrawal / maxMonth) * 100}%` }}
                    title={`출금 ${formatWon(m.withdrawal)}`}
                  />
                </div>
                <div className="text-[10px] text-slate-400">{m.ym.slice(2)}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-emerald-400" /> 입금
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-orange-400" /> 출금
            </span>
          </div>
        </div>
      </Section>

      <p className="text-xs text-slate-400">
        ※ 가수금은 통장 거래의 계정/메모에 “가수금·가지급”이 포함된 항목으로 집계합니다.
        예상지출·고정관리비 계획 등 계획성 항목은 추후 추가 예정입니다.
      </p>
    </div>
  );
}
