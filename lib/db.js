import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export const db = {
  query: (text, params) => sql.query(text, params),
};

export default db;
