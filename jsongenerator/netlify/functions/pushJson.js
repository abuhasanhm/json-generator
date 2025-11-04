// pushJson.js
// Netlify Function: menerima GET (healthcheck) dan POST (push JSON ke GitHub).
// Tempatkan di: netlify/functions/pushJson.js
// Harus ada env vars: NETLIFY_GH_TOKEN (GitHub token), PUSH_SECRET (shared secret)

const https = require('https');

const GH_OWNER = 'abuhasanhm';           // ganti jika repo owner beda
const GH_REPO  = 'data-masjid';          // ganti nama repo tujuan
const GH_PATH  = 'jammasjid_backup_2025-11-03.json';// ganti nama file di repo (path relatif)

function jsonResp(code, obj) {
  return {
    statusCode: code,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // untuk dev. kunci ke origin produksi kalau perlu
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,x-push-secret'
    },
    body: JSON.stringify(obj)
  };
}

function ghRequest(method, path, token, payload) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'User-Agent': 'netlify-function',
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': token ? `token ${token}` : undefined
      }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let parsed;
        try { parsed = d ? JSON.parse(d) : {}; } catch(e) { parsed = d; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', e => reject(e));
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

exports.handler = async function(event) {
  try {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') return jsonResp(200, { ok:true });

    // GET = health / quick info
    if (event.httpMethod === 'GET') {
      return jsonResp(200, { ok:true, msg:'pushJson alive. Use POST with x-push-secret and JSON body to push.' });
    }

    // Only allow POST for push
    if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'Method Not Allowed. Use POST' });

    // Validate secret header
    const headers = Object.assign({}, event.headers || {});
    const pushSecretHeader = headers['x-push-secret'] || headers['X-Push-Secret'] || headers['x-push_secret'];
    const PUSH_SECRET = process.env.PUSH_SECRET || '';
    if (!PUSH_SECRET || !pushSecretHeader || pushSecretHeader !== PUSH_SECRET) {
      return jsonResp(401, { error: 'Unauthorized: missing/invalid x-push-secret header' });
    }

    // Parse body JSON
    let payload;
    try {
      payload = event.body ? JSON.parse(event.body) : null;
    } catch (e) {
      return jsonResp(400, { error: 'Invalid JSON body' });
    }
    if (!payload) return jsonResp(400, { error: 'Empty payload' });

    // Prepare content
    const contentStr = JSON.stringify(payload, null, 2);
    const contentB64 = Buffer.from(contentStr, 'utf8').toString('base64');

    // GitHub token from env
    const GH_TOKEN = process.env.NETLIFY_GH_TOKEN;
    if (!GH_TOKEN) return jsonResp(500, { error: 'Server misconfigured: missing NETLIFY_GH_TOKEN' });

    // Get current file (to obtain sha if exists)
    const fileApiPath = `/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(GH_PATH)}`;
    const getRes = await ghRequest('GET', fileApiPath, GH_TOKEN);

    let sha = null;
    if (getRes.status === 200 && getRes.body && getRes.body.sha) sha = getRes.body.sha;

    // Commit message
    const name = (payload.meta && payload.meta.name) ? payload.meta.name : 'JSON Generator';
    const commitMsg = `Update ${GH_PATH} via ${name} (${new Date().toISOString()})`;

    const putPayload = { message: commitMsg, content: contentB64 };
    if (sha) putPayload.sha = sha;

    // PUT request to create/update file
    const putRes = await ghRequest('PUT', fileApiPath, GH_TOKEN, putPayload);

    if (putRes.status >= 200 && putRes.status < 300) {
      return jsonResp(200, { ok:true, result: putRes.body });
    } else {
      // Return GitHub error details
      return jsonResp(putRes.status || 500, { error: 'GitHub API error', details: putRes.body });
    }

  } catch (err) {
    return jsonResp(500, { error: 'Internal error', message: String(err && err.message ? err.message : err) });
  }
};
