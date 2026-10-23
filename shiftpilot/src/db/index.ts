import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

const globalForDb = globalThis as unknown as { __spPool?: Pool };

function makePool() {
  // Connects lazily on first query, so modules can be imported (e.g. in tests) without a database
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
}

// Reuse one pool across hot reloads in dev
const pool = globalForDb.__spPool ?? makePool();
if (process.env.NODE_ENV !== "production") globalForDb.__spPool = pool;

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export { schema };
