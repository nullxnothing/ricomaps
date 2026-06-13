import { truncateAddress } from '@/lib/address-utils';
import { formatUsd } from '@/lib/format';
import type { InlineKeyboard } from './client';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://ricomaps.fun').replace(/\/$/, '');

/** Escape the three characters that matter for Telegram HTML parse mode. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The alert event kinds the worker can fan into the notify route. */
export type AlertKind = 'bundle-cluster' | 'dev-sell' | 'blacklist-buy' | 'rug';

export interface AlertEvent {
  kind: AlertKind;
  mint: string;
  symbol?: string;
  /** kind=bundle-cluster: cluster count; kind=blacklist-buy: known-bundler match count. */
  count?: number;
  /** kind=dev-sell / blacklist-buy: the acting wallet. */
  wallet?: string;
  /** kind=rug: estimated USD pulled. */
  estExtractedUsd?: number;
  /** kind=bundle-cluster: cabal/bundled supply % at scan time. */
  supplyPct?: number;
}

function label(mint: string, symbol?: string): string {
  return symbol ? `$${esc(symbol)}` : `<code>${esc(truncateAddress(mint))}</code>`;
}

/** Build the alert message + a deep-link keyboard for a single event. */
export function formatAlert(ev: AlertEvent): { text: string; replyMarkup: InlineKeyboard } {
  const tok = label(ev.mint, ev.symbol);
  let text: string;

  switch (ev.kind) {
    case 'bundle-cluster': {
      const clusters = ev.count ?? 0;
      const supply = ev.supplyPct != null ? ` · <b>${ev.supplyPct.toFixed(1)}%</b> of supply` : '';
      text =
        `🧩 <b>Bundle cluster on ${tok}</b>\n` +
        `${clusters} same-slot bundle${clusters === 1 ? '' : 's'} detected${supply}.`;
      break;
    }
    case 'dev-sell': {
      const who = ev.wallet ? ` (<code>${esc(truncateAddress(ev.wallet))}</code>)` : '';
      text = `🚨 <b>Dev sell on ${tok}</b>\nDeployer${who} is offloading. Liquidity risk rising.`;
      break;
    }
    case 'blacklist-buy': {
      const n = ev.count ?? 1;
      text =
        `🚩 <b>Known bundler bought ${tok}</b>\n` +
        `${n} blacklisted wallet${n === 1 ? '' : 's'} from prior launches is in this token.`;
      break;
    }
    case 'rug': {
      const pulled = ev.estExtractedUsd ? ` ~${formatUsd(ev.estExtractedUsd)} extracted.` : '';
      text = `💀 <b>${tok} rugged</b>\nLiquidity collapsed.${pulled}`;
      break;
    }
  }

  const replyMarkup: InlineKeyboard = [
    [{ text: '🫧 Live Bubble Map ↗', url: `${APP_URL}/?mint=${ev.mint}` }],
    [
      { text: '🔕 Unwatch', callback_data: `unwatch:${ev.mint}` },
      { text: 'Solscan', url: `https://solscan.io/token/${ev.mint}` },
    ],
  ];
  return { text, replyMarkup };
}
