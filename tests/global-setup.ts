import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Fresh throwaway sqlite db for API tests. */
export default function setup() {
  const db = path.join(process.cwd(), "prisma", "test.db");
  fs.rmSync(db, { force: true });
  execSync("npx prisma db push", {
    env: { ...process.env, DATABASE_URL: "file:./prisma/test.db" },
    stdio: "inherit",
  });
}
