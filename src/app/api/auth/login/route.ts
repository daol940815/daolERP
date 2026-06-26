import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // bcryptjs는 Node 런타임 필요

export async function POST(req: NextRequest) {
  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) {
    return NextResponse.json({ error: "아이디와 비밀번호를 입력하세요." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { username: String(username) } });
  if (!user || !(await verifyPassword(String(password), user.passwordHash))) {
    return NextResponse.json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const token = await createSessionToken({
    uid: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
  });

  const res = NextResponse.json({ ok: true, username: user.username, name: user.name });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}
