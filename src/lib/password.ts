import bcrypt from "bcryptjs";

// 비밀번호 해시/검증 (bcryptjs — Node 런타임 전용. Edge 미들웨어에서 import 금지)

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
