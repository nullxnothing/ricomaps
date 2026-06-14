import 'server-only';

// Minimal Discord interactions client: Ed25519 request verification (required on
// EVERY interaction) + response helpers. Zero deps — uses Node's webcrypto, which
// supports Ed25519 on Node 18+. Mirrors telegram/client.ts in spirit.

// Discord interaction + response type enums (only the ones we use).
export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 } as const;
export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;
// Message flag: EPHEMERAL (only the invoking user sees it).
export const MessageFlags = { EPHEMERAL: 1 << 6 } as const;

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

/**
 * Verify a Discord interaction request. Discord signs `timestamp + rawBody` with the
 * app's public key (Ed25519); a bad/missing signature MUST be rejected with 401 or
 * Discord disables the endpoint. Returns true only on a valid signature.
 */
export async function verifyDiscordRequest(
  publicKeyHex: string,
  signatureHex: string | null,
  timestamp: string | null,
  rawBody: string,
): Promise<boolean> {
  if (!signatureHex || !timestamp || !publicKeyHex) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(publicKeyHex),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const encoded = new TextEncoder().encode(timestamp + rawBody);
    // Copy into a fresh ArrayBuffer-backed view so the WebCrypto BufferSource types line up.
    const message = new Uint8Array(encoded.length);
    message.set(encoded);
    return await crypto.subtle.verify('Ed25519', key, hexToBytes(signatureHex), message);
  } catch (err) {
    console.error('[discord] signature verify error:', err);
    return false;
  }
}

export interface FollowupPayload {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
}

/** Send a follow-up message to a deferred interaction via the webhook token. */
export async function sendFollowup(applicationId: string, interactionToken: string, payload: FollowupPayload): Promise<void> {
  try {
    await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.error('[discord] followup error:', err);
  }
}
