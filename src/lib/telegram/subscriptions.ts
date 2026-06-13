import 'server-only';
import { getPool } from '@/lib/db-pool';

const pool = getPool();

/** What a chat can subscribe to. `mint` watches a token; `wallet` watches an address. */
export type SubscriptionKind = 'mint' | 'wallet';

export interface TelegramSubscription {
  chatId: number;
  kind: SubscriptionKind;
  target: string; // mint address or wallet address, lowercased-insensitive (base58 is case-sensitive — stored verbatim)
  createdAt: number;
}

// A chat can't watch more than this many targets — keeps the funnel fan-out bounded.
const MAX_PER_CHAT = 50;

// ============================================================================
// IN-MEMORY FALLBACK (mirrors db-cabal.ts so PG and no-PG behave identically)
// ============================================================================
const memSubs = new Map<string, TelegramSubscription>(); // key: `${chatId}:${kind}:${target}`

const memKey = (chatId: number, kind: SubscriptionKind, target: string) => `${chatId}:${kind}:${target}`;

// ============================================================================
// POSTGRES
// ============================================================================
async function initTable(): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS telegram_subscriptions (
        chat_id BIGINT NOT NULL,
        kind VARCHAR(8) NOT NULL,
        target VARCHAR(64) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chat_id, kind, target)
      );
      CREATE INDEX IF NOT EXISTS idx_tg_subs_target ON telegram_subscriptions(kind, target);
    `);
  } catch (error) {
    console.error('[TG Subs] init error:', error);
  }
}

/**
 * Create a subscription. Returns `false` (no-op) if the chat is already at its cap
 * and this is a new target. Idempotent: re-watching an existing target returns `true`.
 */
export async function addSubscription(chatId: number, kind: SubscriptionKind, target: string): Promise<boolean> {
  const key = memKey(chatId, kind, target);
  const alreadyWatched = memSubs.has(key);
  if (!alreadyWatched && countForChatMem(chatId) >= MAX_PER_CHAT) return false;
  memSubs.set(key, { chatId, kind, target, createdAt: Math.floor(Date.now() / 1000) });

  if (!pool) return true;
  try {
    if (!alreadyWatched) {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM telegram_subscriptions WHERE chat_id = $1`,
        [chatId],
      );
      if ((rows[0]?.n ?? 0) >= MAX_PER_CHAT) {
        memSubs.delete(key);
        return false;
      }
    }
    await pool.query(
      `INSERT INTO telegram_subscriptions (chat_id, kind, target)
       VALUES ($1, $2, $3)
       ON CONFLICT (chat_id, kind, target) DO NOTHING`,
      [chatId, kind, target],
    );
  } catch (error) {
    console.error('[TG Subs] add error:', error);
  }
  return true;
}

export async function removeSubscription(chatId: number, kind: SubscriptionKind, target: string): Promise<void> {
  memSubs.delete(memKey(chatId, kind, target));
  if (!pool) return;
  try {
    await pool.query(
      `DELETE FROM telegram_subscriptions WHERE chat_id = $1 AND kind = $2 AND target = $3`,
      [chatId, kind, target],
    );
  } catch (error) {
    console.error('[TG Subs] remove error:', error);
  }
}

/** Chat ids subscribed to a given target — the alert fan-out list. */
export async function getSubscribers(kind: SubscriptionKind, target: string): Promise<number[]> {
  if (!pool) {
    return [...memSubs.values()].filter((s) => s.kind === kind && s.target === target).map((s) => s.chatId);
  }
  try {
    const { rows } = await pool.query(
      `SELECT chat_id FROM telegram_subscriptions WHERE kind = $1 AND target = $2`,
      [kind, target],
    );
    return rows.map((r) => Number(r.chat_id));
  } catch (error) {
    console.error('[TG Subs] subscribers error:', error);
    return [];
  }
}

/** A chat's current watchlist, newest first. */
export async function listSubscriptions(chatId: number): Promise<TelegramSubscription[]> {
  if (!pool) {
    return [...memSubs.values()].filter((s) => s.chatId === chatId).sort((a, b) => b.createdAt - a.createdAt);
  }
  try {
    const { rows } = await pool.query(
      `SELECT kind, target, EXTRACT(EPOCH FROM created_at)::bigint AS created_ts
       FROM telegram_subscriptions WHERE chat_id = $1 ORDER BY created_at DESC`,
      [chatId],
    );
    return rows.map((r) => ({
      chatId,
      kind: r.kind as SubscriptionKind,
      target: r.target as string,
      createdAt: Number(r.created_ts),
    }));
  } catch (error) {
    console.error('[TG Subs] list error:', error);
    return [];
  }
}

function countForChatMem(chatId: number): number {
  let n = 0;
  for (const s of memSubs.values()) if (s.chatId === chatId) n++;
  return n;
}

initTable().catch(console.error);
