import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = { query: async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows };
