// server.js — local CORS proxy for apexlegendsapi.com
// Run with: node server.js
// Requires only Node.js built-ins, no npm install needed.

const http  = require('http');
const https = require('https');

const PORT = 7272;
const API_BASE = 'api.mozambiquehe.re';

const server = http.createServer((req, res) => {
  // Allow requests from any origin (including overwolf-extension://)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'GET')     { res.writeHead(405); res.end(); return; }

  // Parse query params from the incoming request
  const incoming = new URL('http://localhost' + req.url);
  const auth     = incoming.searchParams.get('auth');
  const player   = incoming.searchParams.get('player');
  const platform = incoming.searchParams.get('platform') || 'PC';

  if (!auth || !player) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing auth or player param' }));
    return;
  }

  const path = `/bridge?auth=${encodeURIComponent(auth)}&player=${encodeURIComponent(player)}&platform=${encodeURIComponent(platform)}&version=5`;
  console.log('[proxy] →', `https://${API_BASE}${path.replace(auth, '***')}`);
  const options = { hostname: API_BASE, path, method: 'GET', headers: { 'User-Agent': 'ApexSwag/1.0' } };

  const apiReq = https.request(options, apiRes => {
    let body = '';
    apiRes.on('data', chunk => body += chunk);
    apiRes.on('end', () => {
      console.log('[proxy] ←', apiRes.statusCode, body.substring(0, 120));
      res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
      res.end(body);
    });
  });

  apiReq.on('error', err => {
    console.error('[proxy] API request error:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });

  apiReq.setTimeout(10000, () => {
    apiReq.destroy();
    res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API request timed out' }));
  });

  apiReq.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[apex-swag] Proxy running → http://127.0.0.1:${PORT}`);
  console.log('[apex-swag] Keep this window open while using the Overwolf app.');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[apex-swag] Port ${PORT} already in use. Close the other instance and retry.`);
  } else {
    console.error('[apex-swag] Server error:', err.message);
  }
  process.exit(1);
});
