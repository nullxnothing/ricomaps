import { GraphNode } from './types';

const DANGEROUS_TAGS = new Set(['scammer', 'rugger', 'hacker', 'exploiter']);
const SPAM_TAGS = new Set(['spam']);
const KOL_TAGS = new Set(['kol']);

export const THREAT_COLORS: Record<string, string> = {
  critical: '#ff0000',
  high: '#ff4444',
  medium: '#ff8800',
  low: '#ffcc00',
  safe: '#00cc66',
};

export function computeThreatScore(node: GraphNode): number {
  let score = 0;

  // Identity tag signals
  const tags = node.identity?.tags || [];
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (DANGEROUS_TAGS.has(lower)) { score += 40; break; }
  }
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (SPAM_TAGS.has(lower)) { score += 20; break; }
  }
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (KOL_TAGS.has(lower)) { score += 5; break; }
  }

  // Node type signals
  if (node.type === 'cabal-funder') score += 25;
  if (node.type === 'sniper') score += 20;
  if (node.type === 'bundled') score += 15;

  // Shared funder count — +10 per holder funded beyond 1
  const fundedCount = node.metadata?.fundedCount || 0;
  if (fundedCount > 1) {
    score += (fundedCount - 1) * 10;
  }

  // Fresh wallet bonus
  const walletAgeDays = node.metadata?.walletAgeDays;
  if (walletAgeDays !== undefined && walletAgeDays < 7) {
    score += 10;
  }

  return Math.min(100, score);
}

export type ThreatLevel = 'critical' | 'high' | 'medium' | 'low' | 'safe';

export function getThreatLevel(score: number): ThreatLevel {
  if (score >= 70) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 30) return 'medium';
  if (score >= 15) return 'low';
  return 'safe';
}
