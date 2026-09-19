import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export const db = {
  query: async (text, params) => {
    const result = await sql.query(text, params ?? []);
    return { rows: result };
  },
};

export default db;