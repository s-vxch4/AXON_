import { db } from '../../../../../lib/db.js';

export async function GET(request, { params }) {
  try {
    const result = await db.query(
      'SELECT * FROM dependency_map WHERE repo_id = $1',
      [params.repoId]
    );
    return Response.json({ dependencies: result.rows });
  } catch (error) {
    return Response.json({ dependencies: [] });
  }
}