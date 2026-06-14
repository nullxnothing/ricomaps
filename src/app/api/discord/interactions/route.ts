import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import {
  verifyDiscordRequest,
  InteractionType,
  InteractionResponseType,
  MessageFlags,
} from '@/lib/discord/client';
import { runDiscordCommand, type DiscordCommandData } from '@/lib/discord/commands';

// Discord interactions webhook (slash commands). Discord requires:
//   1. Ed25519 signature verification on every request (else it disables the endpoint).
//   2. A PONG for the initial PING handshake.
//   3. A response within 3s — scans take longer, so we DEFER and the command posts a
//      follow-up via `after()` (runs post-response, Vercel-friendly).

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY ?? '';
const APP_ID = process.env.DISCORD_APPLICATION_ID ?? '';

interface Interaction {
  type: number;
  data?: DiscordCommandData;
  token: string;
  application_id?: string;
}

export async function POST(request: NextRequest) {
  if (!PUBLIC_KEY || !APP_ID) {
    return NextResponse.json({ error: 'Discord not configured' }, { status: 503 });
  }

  // Verify against the RAW body — re-serializing JSON would change bytes and fail.
  const rawBody = await request.text();
  const valid = await verifyDiscordRequest(
    PUBLIC_KEY,
    request.headers.get('x-signature-ed25519'),
    request.headers.get('x-signature-timestamp'),
    rawBody,
  );
  if (!valid) {
    return new NextResponse('invalid request signature', { status: 401 });
  }

  const interaction = JSON.parse(rawBody) as Interaction;

  // 1. Handshake.
  if (interaction.type === InteractionType.PING) {
    return NextResponse.json({ type: InteractionResponseType.PONG });
  }

  // 2. Slash command: defer now, finish in the background.
  if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data) {
    const data = interaction.data;
    const token = interaction.token;
    after(async () => {
      await runDiscordCommand(APP_ID, token, data);
    });
    return NextResponse.json({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: MessageFlags.EPHEMERAL },
    });
  }

  return NextResponse.json({ error: 'Unsupported interaction type' }, { status: 400 });
}
