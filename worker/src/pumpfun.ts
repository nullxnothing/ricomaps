import bs58 from 'bs58';
import type { SubscribeUpdate } from 'helius-laserstream';

/**
 * Pump.fun launch detection from raw LaserStream transaction updates.
 *
 * Two tx classes matter to the atlas:
 *  - CREATE   — new token minted on the bonding curve. Isolated by filtering on the
 *               pump.fun mint authority (signs every create, appears nowhere else).
 *  - MIGRATE  — bonding curve completed; liquidity moves to PumpSwap ("graduation").
 *               Isolated by requiring BOTH programs in one tx, then confirming the
 *               migrate discriminator (rules out aggregator routes touching both).
 */

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMPSWAP_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const PUMP_MINT_AUTHORITY = 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// Anchor discriminators: sha256("global:<name>")[0..8]
const CREATE_DISC = Uint8Array.from([24, 30, 200, 40, 5, 28, 7, 119]);
const MIGRATE_DISC = Uint8Array.from([155, 234, 231, 146, 236, 158, 162, 30]);

export interface PumpCreateEvent {
  mint: string;
  name?: string;
  symbol?: string;
  creator?: string;
  slot: number;
  signature: string;
  ts: number; // unix seconds (worker receive time ≈ chain time at confirmed commitment)
}

export interface PumpMigrationEvent {
  mint: string;
  slot: number;
  signature: string;
  ts: number;
}

type TxInfo = NonNullable<NonNullable<SubscribeUpdate['transaction']>['transaction']>;

interface CompiledIx {
  programIdIndex?: number | null;
  accounts?: Uint8Array | number[] | null;
  data?: Uint8Array | null;
}

function toSlot(slot: unknown): number {
  if (typeof slot === 'number') return slot;
  if (slot && typeof (slot as { toNumber?: () => number }).toNumber === 'function') {
    return (slot as { toNumber: () => number }).toNumber();
  }
  return Number(slot ?? 0) || 0;
}

function resolveAccountKeys(info: TxInfo): string[] {
  const msg = info.transaction?.message;
  const staticKeys = (msg?.accountKeys ?? []) as unknown[];
  const keys = staticKeys.map((k) => {
    if (typeof k === 'string') return k;
    try { return bs58.encode(k as Uint8Array); } catch { return ''; }
  });
  const meta = info.meta;
  for (const k of [...((meta?.loadedWritableAddresses ?? []) as unknown[]), ...((meta?.loadedReadonlyAddresses ?? []) as unknown[])]) {
    try { keys.push(typeof k === 'string' ? k : bs58.encode(k as Uint8Array)); } catch { keys.push(''); }
  }
  return keys;
}

function discMatches(data: Uint8Array | null | undefined, disc: Uint8Array): boolean {
  if (!data || data.length < 8) return false;
  for (let i = 0; i < 8; i++) if (data[i] !== disc[i]) return false;
  return true;
}

/** All instructions (top-level + inner) as a flat list. */
function allInstructions(info: TxInfo): CompiledIx[] {
  const top = (info.transaction?.message?.instructions ?? []) as CompiledIx[];
  const inner: CompiledIx[] = [];
  for (const group of (info.meta?.innerInstructions ?? []) as { instructions?: CompiledIx[] }[]) {
    inner.push(...(group.instructions ?? []));
  }
  return [...top, ...inner];
}

/** Borsh string at `offset`: u32 LE length + utf8 bytes. Returns null on bounds violation. */
function readBorshString(data: Uint8Array, offset: number): { value: string; next: number } | null {
  if (offset + 4 > data.length) return null;
  const len = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
  if (len < 0 || len > 256 || offset + 4 + len > data.length) return null;
  const value = Buffer.from(data.slice(offset + 4, offset + 4 + len)).toString('utf8');
  return { value, next: offset + 4 + len };
}

/**
 * Parse pump.fun `create` instructions out of a transaction update.
 * Mint is the create ix's first account; name/symbol decoded from borsh args
 * (best-effort — a layout change degrades to mint-only, never throws).
 */
export function parsePumpCreates(update: SubscribeUpdate): PumpCreateEvent[] {
  const txUpdate = update.transaction;
  const info = txUpdate?.transaction;
  if (!txUpdate || !info) return [];

  const keys = resolveAccountKeys(info);
  const pumpIndex = keys.indexOf(PUMP_PROGRAM);
  if (pumpIndex === -1) return [];

  const events: PumpCreateEvent[] = [];
  for (const ix of allInstructions(info)) {
    if (ix.programIdIndex !== pumpIndex) continue;
    const data = ix.data ?? undefined;
    if (!discMatches(data, CREATE_DISC)) continue;

    const accountIndexes = [...(ix.accounts ?? [])];
    const mint = keys[accountIndexes[0] ?? -1];
    if (!mint) continue;

    let name: string | undefined;
    let symbol: string | undefined;
    let creator: string | undefined;
    if (data) {
      const n = readBorshString(data, 8);
      const s = n ? readBorshString(data, n.next) : null;
      const u = s ? readBorshString(data, s.next) : null;
      name = n?.value || undefined;
      symbol = s?.value || undefined;
      if (u && u.next + 32 <= data.length) {
        try { creator = bs58.encode(data.slice(u.next, u.next + 32)); } catch { /* mint-only event */ }
      }
    }

    events.push({
      mint, name, symbol, creator,
      slot: toSlot(txUpdate.slot),
      signature: info.signature ? bs58.encode(info.signature as Uint8Array) : '',
      ts: Math.floor(Date.now() / 1000),
    });
  }
  return events;
}

/**
 * Parse a graduation: a pump.fun `migrate` instruction in a tx that also touches
 * PumpSwap. The graduating mint is the non-WSOL mint in the post token balances.
 */
export function parsePumpMigrations(update: SubscribeUpdate): PumpMigrationEvent[] {
  const txUpdate = update.transaction;
  const info = txUpdate?.transaction;
  if (!txUpdate || !info) return [];

  const keys = resolveAccountKeys(info);
  const pumpIndex = keys.indexOf(PUMP_PROGRAM);
  if (pumpIndex === -1 || !keys.includes(PUMPSWAP_PROGRAM)) return [];

  const hasMigrate = allInstructions(info).some(
    (ix) => ix.programIdIndex === pumpIndex && discMatches(ix.data ?? undefined, MIGRATE_DISC)
  );
  if (!hasMigrate) return [];

  // Largest non-WSOL post balance = the graduating token sitting in the new pool.
  let mint = '';
  let best = -1;
  for (const b of (info.meta?.postTokenBalances ?? []) as { mint?: string | null; uiTokenAmount?: { uiAmount?: number | null } | null }[]) {
    if (!b.mint || b.mint === WSOL_MINT) continue;
    const amount = b.uiTokenAmount?.uiAmount ?? 0;
    if (amount > best) { best = amount; mint = b.mint; }
  }
  if (!mint) return [];

  return [{
    mint,
    slot: toSlot(txUpdate.slot),
    signature: info.signature ? bs58.encode(info.signature as Uint8Array) : '',
    ts: Math.floor(Date.now() / 1000),
  }];
}
