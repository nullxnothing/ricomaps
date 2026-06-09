import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { checkRateLimit } from '@/lib/rate-limit';
import { requireGate } from '@/lib/gate-guard';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { getCachedNarrative, setCachedNarrative } from '@/lib/db-cache';
import {
  NarrativeBrief, briefToPromptText, NARRATIVE_SYSTEM_PROMPT, narrativeConfidence,
} from '@/lib/narrative-prompt';

export const maxDuration = 60;

const MODEL = 'claude-opus-4-8';

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed } = checkRateLimit(ip, 'explain');
  if (!allowed) return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });

  // Gated: each call bills Anthropic tokens.
  const gate = await requireGate(request);
  if (gate instanceof NextResponse) return gate;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'AI narrative unavailable' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const { mint, brief } = body as { mint?: string; brief?: NarrativeBrief };

  if (!brief || typeof brief !== 'object' || !brief.token) {
    return NextResponse.json({ success: false, error: 'brief required' }, { status: 400 });
  }
  const cacheKey = typeof mint === 'string' && isValidSolanaAddress(mint) ? mint : null;

  // Return a cached narrative verbatim — no model call, no billing.
  if (cacheKey) {
    const cached = await getCachedNarrative(cacheKey);
    if (cached) {
      return NextResponse.json({ success: true, ...cached, cached: true });
    }
  }

  const confidence = narrativeConfidence(brief.supply?.coveragePct);
  const client = new Anthropic({ apiKey });

  const encoder = new TextEncoder();
  let fullText = '';

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const llmStream = client.messages.stream({
          model: MODEL,
          max_tokens: 1024,
          system: NARRATIVE_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: briefToPromptText(brief) }],
        });

        for await (const event of llmStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullText += event.delta.text;
            controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ text: event.delta.text })}\n\n`));
          }
        }

        // Deterministic factors from the brief (not asked of the model).
        const derivedFactors = deriveFactors(brief);
        const payload = { narrative: fullText.trim(), factors: derivedFactors, confidence };
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify(payload)}\n\n`));
        controller.close();

        if (cacheKey && fullText.trim()) {
          setCachedNarrative(cacheKey, payload).catch(() => {});
        }
      } catch (err) {
        console.error('[Explain] stream error:', err);
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: 'Narrative generation failed' })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

function deriveFactors(b: NarrativeBrief): string[] {
  const out: string[] = [];
  if (b.cabal.fingerprintMatches > 0) out.push(`Known crew — ${b.cabal.fingerprintMatches} prior token(s)`);
  if (b.supply && b.supply.cabalPct > 0) out.push(`Cabal holds ${b.supply.cabalPct.toFixed(1)}% of supply`);
  if (b.supply && b.supply.bundledPct > 0) out.push(`${b.supply.bundledPct.toFixed(1)}% bundled`);
  if (b.snipers > 0) out.push(`${b.snipers} snipers`);
  if (b.deployer?.isSerial) out.push('Serial deployer');
  if (b.supply && b.supply.top10Pct > 50) out.push(`Top 10 hold ${b.supply.top10Pct.toFixed(0)}%`);
  return out.slice(0, 4);
}
