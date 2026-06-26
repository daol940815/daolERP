"use client";

import { useState } from "react";

interface ImportResult {
  ok: boolean;
  replace: boolean;
  counts: { inv: number; card: number; bank: number };
  summary: { sheet: string; type: string; count: number }[];
  warnings: string[];
}

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("replace", String(replace));
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "가져오기 실패");
      setResult(data);
    } catch (e: any) {
      setError(e.message || "가져오기에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">엑셀 가져오기</h1>
        <p className="mt-1 text-sm text-slate-500">
          기존 자회사 종합관리 엑셀 파일(.xlsx)을 업로드하면 시트를 자동으로
          분석해 <b>세금계산서 · 카드사용내역 · 통장거래</b>로 분류하여 저장합니다.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
        <div>
          <label className="field-label">엑셀 파일 선택 (.xlsx)</label>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-md file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-dark"
          />
          {file && (
            <div className="mt-2 text-sm text-slate-500">
              선택됨: <b>{file.name}</b> ({(file.size / 1024 / 1024).toFixed(1)} MB)
            </div>
          )}
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <b>가져오기 전에 기존 데이터를 모두 비우고 새로 채웁니다.</b>
            <br />
            <span className="text-slate-400">
              체크 해제 시 기존 데이터에 <b>추가</b>됩니다 (중복 입력될 수 있으니
              주의하세요).
            </span>
          </span>
        </label>

        <button className="btn-primary" onClick={upload} disabled={!file || loading}>
          {loading ? "분석·저장 중..." : "가져오기 실행"}
        </button>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
          <div className="text-lg font-semibold text-emerald-800">
            ✅ 가져오기 완료
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-white p-3">
              <div className="text-xs text-slate-500">세금계산서</div>
              <div className="text-xl font-bold text-blue-600">{result.counts.inv}</div>
            </div>
            <div className="rounded-lg bg-white p-3">
              <div className="text-xs text-slate-500">카드사용내역</div>
              <div className="text-xl font-bold text-rose-600">{result.counts.card}</div>
            </div>
            <div className="rounded-lg bg-white p-3">
              <div className="text-xs text-slate-500">통장거래</div>
              <div className="text-xl font-bold text-emerald-600">{result.counts.bank}</div>
            </div>
          </div>

          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">시트</th>
                <th>분류</th>
                <th className="text-right">건수</th>
              </tr>
            </thead>
            <tbody>
              {result.summary.map((s) => (
                <tr key={s.sheet} className="border-t border-emerald-100">
                  <td className="py-1">{s.sheet}</td>
                  <td className="text-slate-500">{s.type}</td>
                  <td className="text-right tabular-nums">{s.count}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {result.warnings.length > 0 && (
            <ul className="mt-3 list-inside list-disc text-xs text-amber-600">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          <div className="mt-4 text-sm text-emerald-700">
            왼쪽 메뉴에서 가져온 데이터를 확인하세요.
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        <h2 className="font-semibold text-slate-700">인식하는 시트</h2>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>매출(과세), 매출(면세) → 매출 세금계산서</li>
          <li>과세계(입), 면세계(입) → 매입 세금계산서</li>
          <li>우리카드및기타지출 → 카드 사용내역</li>
          <li>입금통장, 출금통장 → 통장 입출금</li>
        </ul>
        <p className="mt-2 text-xs text-slate-400">
          그 외 시트(영업/매출이력, 자금현황 집계 등)는 다음 단계에서 추가될
          예정입니다.
        </p>
      </div>
    </div>
  );
}
