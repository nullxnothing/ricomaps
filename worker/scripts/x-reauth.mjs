// One-off X (Twitter) OAuth2 PKCE re-authorization for the @RicoMaps reply bot.
//
// Run this when the bot's refresh token is dead (logs show `invalid_request:
// Value passed for the token was invalid`) and you need a fresh access+refresh
// pair. It performs the Authorization Code + PKCE flow against X, prints the new
// tokens, and you paste them into the Render worker env (X_ACCESS_TOKEN,
// X_REFRESH_TOKEN). No DB surgery needed — the hardened worker prefers a freshly
// seeded X_REFRESH_TOKEN over a dead stored one on the next refresh.
//
// Prereqs (from the X developer portal → your app → User authentication settings):
//   - App type: Web App / Confidential client (has a client secret) is fine; a
//     Public client works too (omit X_CLIENT_SECRET).
//   - Type of App: set so OAuth2 is enabled with scopes tweet.read tweet.write
//     users.read offline.access.
//   - Callback URI: add EXACTLY  http://127.0.0.1:8723/callback  (must match
//     REDIRECT_URI below; X requires an exact registered match).
//
// Usage (PowerShell):
//   $env:X_CLIENT_ID="..."; $env:X_CLIENT_SECRET="..."   # secret only if confidential
//   node scripts/x-reauth.mjs
// then open the printed URL, authorize as @RicoMaps, and copy the tokens it prints.

import http from 'node:http';
import crypto from 'node:crypto';

const CLIENT_ID = process.env.X_CLIENT_ID;
const CLIENT_SECRET = process.env.X_CLIENT_SECRET || ''; // empty => public client
const REDIRECT_URI = 'http://127.0.0.1:8723/callback';
const PORT = 8723;
const SCOPES = 'tweet.read tweet.write users.read offline.access';
const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';

if (!CLIENT_ID) {
  console.error('Set X_CLIENT_ID (and X_CLIENT_SECRET if your X app is a confidential client) and re-run.');
  process.exit(1);
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const verifier = b64url(crypto.randomBytes(32));
const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
const state = b64url(crypto.randomBytes(16));

const authUrl = new URL(AUTHORIZE_URL);
authUrl.search = new URLSearchParams({
  response_type: 'code',
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  scope: SCOPES,
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
}).toString();

async function exchange(code) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (CLIENT_SECRET) {
    headers.Authorization = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
  }
  const res = await fetch(TOKEN_URL, { method: 'POST', headers, body: params });
  const body = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  return body;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname !== '/callback') {
    res.writeHead(404).end('not found');
    return;
  }
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  if (!code || returnedState !== state) {
    res.writeHead(400).end('bad state/code; restart the script');
    console.error('State mismatch or missing code. Restart and try again.');
    server.close();
    return;
  }
  try {
    const tokens = await exchange(code);
    res.writeHead(200, { 'Content-Type': 'text/plain' })
       .end('Authorized. Tokens printed in the terminal — you can close this tab.');
    console.log('\n=== New X tokens — set these on the Render worker ===\n');
    console.log(`X_ACCESS_TOKEN=${tokens.access_token}`);
    console.log(`X_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`\n(expires_in=${tokens.expires_in}s, scope="${tokens.scope}")`);
    console.log('\nThen redeploy the worker. No DB delete needed — the worker will');
    console.log('prefer this freshly seeded X_REFRESH_TOKEN over the dead stored one.\n');
  } catch (err) {
    res.writeHead(500).end('exchange failed; see terminal');
    console.error(err);
  } finally {
    server.close();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\nOpen this URL in a browser logged in as @RicoMaps and authorize:\n');
  console.log(authUrl.toString());
  console.log(`\nWaiting for the callback on ${REDIRECT_URI} ...\n`);
});
