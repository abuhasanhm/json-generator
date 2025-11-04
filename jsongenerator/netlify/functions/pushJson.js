// netlify/functions/pushJson.js
exports.handler = async function(event) {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const secretHeader = event.headers['x-push-secret'] || event.headers['X-Push-Secret'] || '';
    const expected = process.env.PUSH_SECRET || '';
    if (!expected || secretHeader !== expected)
      return { statusCode: 401, body: 'Unauthorized' };

    const GH_TOKEN = process.env.NETLIFY_GH_TOKEN;
    const OWNER = process.env.GITHUB_OWNER;
    const REPO = process.env.GITHUB_REPO;
    const DEFAULT_PATH = process.env.DEFAULT_PATH || 'jammasjid.json';
    const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH || 'main';

    if (!GH_TOKEN || !OWNER || !REPO)
      return { statusCode: 500, body: 'Server not configured' };

    const body = JSON.parse(event.body || '{}');
    const content = body.content;
    if (!content) return { statusCode: 400, body: 'Missing content' };

    const path = body.path || DEFAULT_PATH;
    const branch = body.branch || DEFAULT_BRANCH;
    const message = body.message || `Update ${path} via generator`;

    const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`;

    // --- check if file exists ---
    const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, {
      headers: { Authorization: `token ${GH_TOKEN}`, 'User-Agent': 'masjid-generator' }
    });
    let sha = null;
    if (getRes.status === 200) {
      const getJson = await getRes.json();
      sha = getJson.sha;
    } else if (getRes.status !== 404) {
      const txt = await getRes.text();
      return { statusCode: getRes.status, body: `Error reading file: ${txt}` };
    }

    // --- prepare payload ---
    const payload = {
      message,
      content: Buffer.from(content).toString('base64'),
      branch
    };
    if (sha) payload.sha = sha;

    // --- upload to GitHub ---
    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        Authorization: `token ${GH_TOKEN}`,
        'User-Agent': 'masjid-generator',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const putJson = await putRes.json();
    if (!putRes.ok) return { statusCode: putRes.status, body: JSON.stringify(putJson) };

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        file: path,
        url: putJson.content.html_url,
        commit: putJson.commit.html_url
      })
    };
  } catch (err) {
    return { statusCode: 500, body: String(err) };
  }
};
