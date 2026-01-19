import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Streaming DISABLED - API rate limits exceeded
 *
 * Re-enable when you have a paid Helius plan or more API keys
 */
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send disabled message
      const msg = JSON.stringify({
        type: 'connected',
        addresses: [],
        timestamp: Date.now(),
        disabled: true,
        message: 'Live streaming paused - upgrade to enable',
      });
      controller.enqueue(encoder.encode(`data: ${msg}\n\n`));

      // Just heartbeats, no polling
      const intervalId = setInterval(() => {
        try {
          const heartbeat = JSON.stringify({ type: 'heartbeat', timestamp: Date.now() });
          controller.enqueue(encoder.encode(`data: ${heartbeat}\n\n`));
        } catch {
          // Controller closed, ignore
        }
      }, 30000);

      request.signal.addEventListener('abort', () => {
        clearInterval(intervalId);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
