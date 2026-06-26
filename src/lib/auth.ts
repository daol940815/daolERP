import { SignJWT, jwtVerify } from "jose";

// ─────────────────────────────────────────────────────────
// 인증 유틸 (세션: jose JWT)
//  - 세션 토큰 생성/검증만 담당하며 next/headers 에 의존하지 않아
//    Edge(미들웨어)에서도 안전하게 import 가능
//  - 쿠키에서 세션을 읽는 getSession 은 auth-session.ts(서버 전용) 참고
//  - 비밀번호 해시(bcryptjs)는 password.ts(Node 런타임) 참고
// ─────────────────────────────────────────────────────────

export const SESSION_COOKIE = "daol_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7일

export interface SessionPayload {
  uid: number;
  username: string;
  role: string;
  name?: string | null;
}

function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET 환경변수가 설정되지 않았거나 너무 짧습니다.");
  }
  return new TextEncoder().encode(s);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return {
      uid: Number(payload.uid),
      username: String(payload.username),
      role: String(payload.role),
      name: (payload.name as string) ?? null,
    };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE,
};
