import { PrismaClient } from "@prisma/client";

// 개발 모드에서 핫리로드 시 커넥션이 누적되는 것을 방지하기 위해
// 전역에 단일 PrismaClient 인스턴스를 재사용합니다.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
