import { db } from '../../../../../lib/db.js';

export async function GET(request, { params }) {
  const { repoId } = params;

  const rows = await db.query(
    'SELECT * FROM dependency_map WHERE repo_id = $1 ORDER BY api_name, file_path',
    [repoId]
  );

  return Response.json({ dependencies: rows || [] });
}
