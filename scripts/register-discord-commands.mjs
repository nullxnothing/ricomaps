// One-shot: register RicoMaps slash commands with Discord (global). Run after any
// change to the command list. Requires DISCORD_APPLICATION_ID + DISCORD_BOT_TOKEN.
//   node scripts/register-discord-commands.mjs
import { config } from 'dotenv';
config({ path: '.env.local' });

const APP_ID = process.env.DISCORD_APPLICATION_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!APP_ID || !BOT_TOKEN) {
  console.error('Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in .env.local');
  process.exit(1);
}

const commands = [
  {
    name: 'scan',
    description: 'Full forensic scan of a Solana token (rug, cabal, snipers, bundles)',
    options: [{ name: 'address', description: 'Token contract address', type: 3, required: true }],
  },
  {
    name: 'price',
    description: 'Quick market snapshot for a token',
    options: [{ name: 'address', description: 'Token contract address', type: 3, required: true }],
  },
  {
    name: 'pnl',
    description: 'SOL-flow PnL + portfolio for a wallet',
    options: [{ name: 'wallet', description: 'Wallet address', type: 3, required: true }],
  },
  {
    name: 'x',
    description: 'Check whether an X account has been recycled / renamed',
    options: [{ name: 'handle', description: 'X handle (without @)', type: 3, required: true }],
  },
];

const res = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/commands`, {
  method: 'PUT', // PUT replaces the full global command set
  headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  console.error(`Registration failed: HTTP ${res.status}`, await res.text());
  process.exit(1);
}
console.log(`Registered ${commands.length} commands:`, (await res.json()).map((c) => `/${c.name}`).join(' '));
