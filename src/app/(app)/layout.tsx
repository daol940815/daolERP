import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import LogoutButton from "@/components/LogoutButton";

const NAV = [
  { href: "/", label: "대시보드", icon: "🏠" },
  { href: "/fund", label: "자금현황", icon: "💰" },
  { href: "/sales", label: "영업/매출이력", icon: "📈" },
  { href: "/invoices/sales", label: "매출 계산서", icon: "🧾" },
  { href: "/invoices/purchase", label: "매입 계산서", icon: "📑" },
  { href: "/cards", label: "카드 사용내역", icon: "💳" },
  { href: "/bank", label: "통장 입출금", icon: "🏦" },
  { href: "/import", label: "엑셀 가져오기", icon: "⬆️" },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 미들웨어에서 1차 보호하지만, 레이아웃에서도 세션을 확인해 사용자 정보를 표시
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-200 px-5 py-4">
          <Link href="/" className="block">
            <div className="text-lg font-bold text-brand">스피어스 ERP</div>
            <div className="text-xs text-slate-400">(주)스피어스 종합관리</div>
          </Link>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-blue-50 hover:text-brand"
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-200 px-5 py-3">
          <div className="text-xs text-slate-500">
            {session.name || session.username}
            <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">
              {session.role}
            </span>
          </div>
          <LogoutButton />
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-3 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2 md:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:text-brand"
            >
              {item.icon} {item.label}
            </Link>
          ))}
          <LogoutButton compact />
        </header>

        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
