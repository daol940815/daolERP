/**
 * 최초 관리자 계정 생성/갱신 스크립트
 * 환경변수 ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_NAME 를 사용합니다.
 * 실행:  npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "관리자";

  if (!username || !password) {
    // 빌드(배포) 과정에서 호출될 수 있으므로 빌드를 깨뜨리지 않고 건너뜀
    console.warn("⚠️  ADMIN_USERNAME / ADMIN_PASSWORD 미설정 — 관리자 시드를 건너뜁니다.");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { username },
    update: { passwordHash, name, role: "admin" },
    create: { username, passwordHash, name, role: "admin" },
  });

  console.log(`✅ 관리자 계정 준비 완료: ${user.username} (role=${user.role})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
