import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Single PrismaClient per process. DATABASE_URL like "file:./prisma/dev.db"
 * resolves relative to the project root for both `next dev` and the CLI
 * (see prisma7.config.ts); an absolute default keeps ad-hoc scripts honest.
 */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const url =
      process.env.DATABASE_URL ??
      `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
    globalForPrisma.prisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url }),
    });
  }
  return globalForPrisma.prisma;
}
