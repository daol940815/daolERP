"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatWon, formatDate } from "@/lib/format";

export type FieldType = "text" | "won" | "date" | "number" | "select" | "usd";

export interface ColumnDef {
  key: string;
  label: string;
  type?: FieldType;
  width?: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type?: FieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
  full?: boolean; // 폼에서 한 줄 전체 차지
}

export interface DataManagerProps {
  title: string;
  description?: string;
  apiPath: string; // 예: "/api/invoices"
  query?: Record<string, string>; // 목록 필터 + 신규 등록 기본값
  columns: ColumnDef[];
  fields: FieldDef[];
  searchPlaceholder?: string;
  // 합계 표시할 컬럼 키들 (won 타입)
  sumKeys?: string[];
}

type Row = Record<string, any>;

function renderCell(value: any, type?: FieldType) {
  if (value == null || value === "") return <span className="text-slate-300">-</span>;
  if (type === "won") return <span className="num">{formatWon(Number(value))}</span>;
  if (type === "usd") return <span className="num">{Number(value).toFixed(2)}</span>;
  if (type === "date") return formatDate(value);
  return String(value);
}

export default function DataManager(props: DataManagerProps) {
  const { title, description, apiPath, query, columns, fields, searchPlaceholder, sumKeys } = props;

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams(query ?? {});
    if (search.trim()) sp.set("q", search.trim());
    return sp.toString();
  }, [query, search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiPath}?${queryString}`, { cache: "no-store" });
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setError("목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [apiPath, queryString]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  function openNew() {
    const base: Row = { ...(query ?? {}) };
    setEditing(base);
    setShowForm(true);
    setError(null);
  }
  function openEdit(row: Row) {
    setEditing({ ...row });
    setShowForm(true);
    setError(null);
  }
  function closeForm() {
    setShowForm(false);
    setEditing(null);
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const isEdit = !!editing.id;
      const url = isEdit ? `${apiPath}/${editing.id}` : apiPath;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      if (!res.ok) throw new Error("저장 실패");
      closeForm();
      await load();
    } catch {
      setError("저장에 실패했습니다. 입력값을 확인해주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: Row) {
    if (!confirm("이 항목을 삭제할까요? 되돌릴 수 없습니다.")) return;
    await fetch(`${apiPath}/${row.id}`, { method: "DELETE" });
    await load();
  }

  const sums = useMemo(() => {
    const acc: Record<string, number> = {};
    if (sumKeys) {
      for (const k of sumKeys) acc[k] = rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    }
    return acc;
  }, [rows, sumKeys]);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        <button className="btn-primary" onClick={openNew}>
          + 새로 등록
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          className="field-input max-w-xs"
          placeholder={searchPlaceholder ?? "검색..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-sm text-slate-400">{loading ? "불러오는 중..." : `${rows.length}건`}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={c.width ? { width: c.width } : undefined}>
                  {c.label}
                </th>
              ))}
              <th className="w-24 text-right">관리</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={columns.length + 1} className="py-8 text-center text-slate-400">
                  데이터가 없습니다. 우측 상단 “새로 등록” 또는 “엑셀 가져오기”를 이용하세요.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((c) => (
                  <td key={c.key} className={c.type === "won" || c.type === "usd" ? "num" : ""}>
                    {renderCell(row[c.key], c.type)}
                  </td>
                ))}
                <td className="text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                      onClick={() => openEdit(row)}
                    >
                      수정
                    </button>
                    <button
                      className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                      onClick={() => remove(row)}
                    >
                      삭제
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {sumKeys && sumKeys.length > 0 && rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                {columns.map((c, i) => (
                  <td key={c.key} className={c.type === "won" ? "num" : ""}>
                    {i === 0 ? "합계" : sumKeys.includes(c.key) ? formatWon(sums[c.key]) : ""}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {showForm && editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-8 w-full max-w-2xl rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h2 className="font-semibold text-slate-800">
                {editing.id ? "수정" : "새로 등록"}
              </h2>
              <button onClick={closeForm} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key} className={f.full ? "sm:col-span-2" : ""}>
                  <label className="field-label">
                    {f.label}
                    {f.required && <span className="text-red-500"> *</span>}
                  </label>
                  {f.type === "select" ? (
                    <select
                      className="field-input"
                      value={editing[f.key] ?? ""}
                      onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}
                    >
                      <option value="">선택</option>
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="field-input"
                      type={f.type === "date" ? "date" : f.type === "number" || f.type === "won" || f.type === "usd" ? "text" : "text"}
                      inputMode={f.type === "won" || f.type === "number" ? "numeric" : undefined}
                      placeholder={f.placeholder}
                      value={
                        f.type === "date"
                          ? formatDate(editing[f.key])
                          : editing[f.key] ?? ""
                      }
                      onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
            {error && <div className="px-5 text-sm text-red-500">{error}</div>}
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button className="btn-ghost" onClick={closeForm}>
                취소
              </button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && !showForm && <div className="text-sm text-red-500">{error}</div>}
    </div>
  );
}
