"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LogoutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  if (compact) {
    return (
      <button onClick={logout} disabled={loading} className="ml-auto whitespace-nowrap rounded-md px-2 py-1 text-xs text-slate-500 hover:text-red-500">
        로그아웃
      </button>
    );
  }

  return (
    <button
      onClick={logout}
      disabled={loading}
      className="mt-2 w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-red-50 hover:text-red-600"
    >
      {loading ? "로그아웃 중..." : "로그아웃"}
    </button>
  );
}
