import { NextResponse } from 'next/server';

const API_VERSION = '1.0.0';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    version: API_VERSION,
    timestamp: new Date().toISOString(),
  });
}
