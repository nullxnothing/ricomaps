#!/usr/bin/env node
// Registers (or inspects) the Telegram webhook for the RicoMaps bot.
//
// Usage:
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
//   node scripts/telegram-set-webhook.mjs https://ricomaps.fun/api/telegram/webhook
//
//   node scripts/telegram-set-webhook.mjs --info     # show current webhook
//   node scripts/telegram-set-webhook.mjs --delete   # remove webhook
//
// The bot token and webhook secret come from the environment — never commit them.

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).then((r) => r.json());

const arg = process.argv[2];

if (arg === '--info') {
  console.log(JSON.stringify(await api('getWebhookInfo'), null, 2));
  process.exit(0);
}
if (arg === '--delete') {
  console.log(JSON.stringify(await api('deleteWebhook'), null, 2));
  process.exit(0);
}

const me = await api('getMe');
if (!me.ok) {
  console.error('getMe failed:', me.description);
  process.exit(1);
}
console.log(`Bot: @${me.result.username} (${me.result.first_name})`);

if (!arg) {
  console.error('\nPass the public webhook URL, e.g.\n  node scripts/telegram-set-webhook.mjs https://ricomaps.fun/api/telegram/webhook');
  process.exit(1);
}
if (!secret) {
  console.error('TELEGRAM_WEBHOOK_SECRET is required to set the webhook');
  process.exit(1);
}

const res = await api('setWebhook', {
  url: arg,
  secret_token: secret,
  allowed_updates: ['message', 'callback_query', 'inline_query'],
});
console.log(JSON.stringify(res, null, 2));
process.exit(res.ok ? 0 : 1);
