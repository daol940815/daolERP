"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatWon, formatDate } from "@/lib/format";

// 파이프라인 단계 정의
export const STAGES = [
  { key: "견적", color: "bg-slate-100 text-slate-700 border-slate-200" },
  { key: "계산서발행", color: "bg-blue-100 text-blue-700 border-blue-200" },
  { key: "입금완료", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  { key: "미납품", color: "bg-orange-100 text-orange-700 border-orange-200" },
  { key: "손실", color: "bg-red-100 text-red-700 border-red-200" },
];
const stageColor = (s: string) =>
  STAGES.find((x) => x.key === s)?.color ?? "bg-slate-100 text-slate-700 border-slate-200";

type Deal = Record<string, any>;

interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "won" | "date" | "select";
  options?: string[];
  full?: boolean;
}

const FORM_FIELDS: FieldDef[] = [
  { key: "dealDate", label: "날짜", type: "date" },
  { key: "stage", label: "단계", type: "select", options: STAGES.map((s) => s.key) },
  { key: "introducer", label: "소개자" },
  { key: "channel", label: "수신(채널)" },
  { key: "customerName", label: "고객명(회사)" },
  { key: "customerOwner", label: "고객 담당자" },
  { key: "finalCustomer", label: "최종 고객사" },
  { key: "finalOwner", label: "최종 고객 담당" },
  { key: "title", label: "제목", full: true },
  { key: "model", label: "모델명", full: true },
  { key: "relatedInfo", label: "관련 정보", full: true },
  { key: "purchasePrice", label: "매입가", type: "won" },
  { key: "salesPrice", label: "매출가", type: "won" },
  { key: "margin", label: "마진", type: "won" },
  { key: "commission", label: "수수료", type: "won" },
  { key: "operatingProfit", label: "영업이익", type: "won" },
  { key: "invoiceIssuer", label: "계산서 발행처" },
  { key: "invoiceDate", label: "계산서 발행일", type: "date" },
  { key: "paymentDate", label: "입금일", type: "date" },
  { key: "paymentAmount", label: "입금액(부가세 포함)", type: "won" },
  { key: "note", label: "비고/상태 메모", full: true },
];

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-bold ${accent}`}>{value}</div>
    </div>
  );
}

export default function SalesManager() {
  const [rows, setRows] = useState<Deal[]>([]);
  const [allRows, setAllRows] = useState<Deal[]>([]); // 통계용 (전체)
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState("ALL");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Deal | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    if (stage !== "ALL") sp.set("stage", stage);
    if (search.trim()) sp.set("q", search.trim());
    return sp.toString();
  }, [stage, search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, allRes] = await Promise.all([
        fetch(`/api/sales?${qs}`, { cache: "no-store" }),
        fetch(`/api/sales`, { cache: "no-store" }),
      ]);
      setRows(await listRes.json());
      setAllRows(await allRes.json());
    } catch {
      setError("목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const stats = useMemo(() => {
    const totalSales = allRows.reduce((s, r) => s + (r.salesPrice || 0), 0);
    const totalProfit = allRows.reduce((s, r) => s + (r.operatingProfit || 0), 0);
    const paid = allRows.filter((r) => r.stage === "입금완료");
    const paidAmount = paid.reduce((s, r) => s + (r.paymentAmount || 0), 0);
    const byStage: Record<string, number> = {};
    for (const r of allRows) byStage[r.stage] = (byStage[r.stage] || 0) + 1;
    return { totalSales, totalProfit, paidAmount, paidCount: paid.length, byStage, total: allRows.length };
  }, [allRows]);

  function openNew() {
    setEditing({ stage: "견적" });
    setError(null);
  }
  function save() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    const isEdit = !!editing.id;
    fetch(isEdit ? `/api/sales/${editing.id}` : "/api/sales", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        setEditing(null);
        load();
      })
      .catch(() => setError("저장에 실패했습니다."))
      .finally(() => setSaving(false));
  }
  async function remove(row: Deal) {
    if (!confirm("이 딜을 삭제할까요? 되돌릴 수 없습니다.")) return;
    await fetch(`/api/sales/${row.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="mx-auto max-w-[88rem] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">영업 / 매출이력</h1>
          <p className="mt-1 text-sm text-slate-500">견적 → 계산서 발행 → 입금 파이프라인 관리</p>
        </div>
        <button className="btn-primary" onClick={openNew}>
          + 새 딜 등록
        </button>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="전체 딜" value={`${stats.total} 건`} accent="text-slate-800" />
        <StatCard label="파이프라인 매출 합계" value={`${formatWon(stats.totalSales)} 원`} accent="text-blue-600" />
        <StatCard label="영업이익 합계" value={`${formatWon(stats.totalProfit)} 원`} accent="text-emerald-600" />
        <StatCard label={`입금완료 (${stats.paidCount}건)`} value={`${formatWon(stats.paidAmount)} 원`} accent="text-violet-600" />
      </div>

      {/* 단계 필터 + 검색 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStage("ALL")}
          className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
            stage === "ALL" ? "border-brand bg-brand text-white" : "border-slate-300 bg-white text-slate-600"
          }`}
        >
          전체 {stats.total}
        </button>
        {STAGES.map((s) => (
          <button
            key={s.key}
            onClick={() => setStage(s.key)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
              stage === s.key ? "border-brand bg-brand text-white" : `${s.color}`
            }`}
          >
            {s.key} {stats.byStage[s.key] ?? 0}
          </button>
        ))}
        <input
          className="field-input ml-auto max-w-xs"
          placeholder="고객·제목·모델 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="data-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>단계</th>
              <th>고객명</th>
              <th>최종 고객사</th>
              <th>제목 / 모델</th>
              <th className="text-right">매입가</th>
              <th className="text-right">매출가</th>
              <th className="text-right">마진</th>
              <th className="text-right">영업이익</th>
              <th>입금일</th>
              <th className="w-20 text-right">관리</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={11} className="py-8 text-center text-slate-400">
                  딜이 없습니다. “새 딜 등록” 또는 “엑셀 가져오기”를 이용하세요.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{formatDate(r.dealDate)}</td>
                <td>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${stageColor(r.stage)}`}>
                    {r.stage}
                  </span>
                </td>
                <td className="whitespace-nowrap font-medium text-slate-700">{r.customerName || "-"}</td>
                <td className="whitespace-nowrap text-slate-500">{r.finalCustomer || "-"}</td>
                <td className="max-w-[16rem]">
                  <div className="truncate text-slate-700" title={r.title || ""}>{r.title || "-"}</div>
                  <div className="truncate text-xs text-slate-400" title={r.model || ""}>{r.model || ""}</div>
                </td>
                <td className="num text-slate-500">{formatWon(r.purchasePrice)}</td>
                <td className="num font-medium">{formatWon(r.salesPrice)}</td>
                <td className="num text-blue-600">{formatWon(r.margin)}</td>
                <td className="num font-semibold text-emerald-600">{formatWon(r.operatingProfit)}</td>
                <td className="whitespace-nowrap text-slate-500">{formatDate(r.paymentDate)}</td>
                <td className="text-right">
                  <div className="flex justify-end gap-1">
                    <button className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100" onClick={() => setEditing({ ...r })}>
                      수정
                    </button>
                    <button className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50" onClick={() => remove(r)}>
                      삭제
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-sm text-slate-400">{loading ? "불러오는 중..." : `${rows.length}건 표시`}</div>

      {/* 등록/수정 모달 */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-8 w-full max-w-3xl rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h2 className="font-semibold text-slate-800">{editing.id ? "딜 수정" : "새 딜 등록"}</h2>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              {FORM_FIELDS.map((f) => (
                <div key={f.key} className={f.full ? "sm:col-span-2" : ""}>
                  <label className="field-label">{f.label}</label>
                  {f.type === "select" ? (
                    <select
                      className="field-input"
                      value={editing[f.key] ?? ""}
                      onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}
                    >
                      {f.options?.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="field-input"
                      inputMode={f.type === "won" ? "numeric" : undefined}
                      value={f.type === "date" ? formatDate(editing[f.key]) : editing[f.key] ?? ""}
                      type={f.type === "date" ? "date" : "text"}
                      onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
            {error && <div className="px-5 text-sm text-red-500">{error}</div>}
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button className="btn-ghost" onClick={() => setEditing(null)}>취소</button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
