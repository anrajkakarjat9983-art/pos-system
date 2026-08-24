import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";

const prisma = new PrismaClient();

const users = await prisma.user.count();
if (users === 0) {
  console.log("Empty database - seeding demo data...");
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
} else {
  console.log(`Database ready (${users} users).`);
}
await prisma.$disconnect();
