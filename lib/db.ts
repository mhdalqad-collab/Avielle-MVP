import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
function client() {
  const prisma = new PrismaClient();
  // GoDaddy managed hosting requires HTTPS transport. VPS can use direct PostgreSQL.
  return process.env.DATABASE_URL?.startsWith("prisma://")
    ? prisma.$extends(withAccelerate()) as unknown as PrismaClient
    : prisma;
}
export const db = globalDb.prisma ?? client();
if (process.env.NODE_ENV !== "production") globalDb.prisma = db;
