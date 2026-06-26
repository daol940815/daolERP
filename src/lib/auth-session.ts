import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from "./auth";

// 서버 컴포넌트/라우트 핸들러에서 현재 로그인 사용자 조회 (next/headers 사용 — 서버 전용)
export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
