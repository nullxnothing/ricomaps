import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { getTokenBalanceForMint } from './helius';

// The token that gates the heavier features. Holding any amount unlocks them.
export const GATE_MINT = process.env.GATE_TOKEN_MINT ?? '6tf2X4GbYdM59hAMNa5kgyja2C9CjwUVqr9YLvJ1pump';
// Minimum UI-unit balance required. Default 0 → "any holder". Raise via env later.
export const GATE_MIN_BALANCE = Number(process.env.GATE_MIN_BALANCE ?? 0);

export const GATE_COOKIE = 'rico_gate';
const SESSION_TTL = '12h';
// Nonces are short-lived and single-message; the signature itself is the proof.
const NONCE_TTL_MS = 5 * 60 * 1000;

function getSecret(): Uint8Array {
  const secret = process.env.GATE_SESSION_SECRET;
  if (!secret) throw new Error('GATE_SESSION_SECRET is not set');
  return new TextEncoder().encode(secret);
}

/** The exact message a wallet signs to prove ownership. Includes a nonce + expiry. */
export function buildSignMessage(nonce: string, issuedAt: number): string {
  return [
    'Rico Maps · unlock holder features',
    '',
    'Sign this message to prove you hold $RICO.',
    'This is free and does not authorize any transaction.',
    '',
    `Nonce: ${nonce}`,
    `Issued: ${new Date(issuedAt).toISOString()}`,
  ].join('\n');
}

export interface GateSession {
  address: string;
  balance: number;
  exp: number;
}

/** ed25519 verify that `address` signed the message. Address is base58, sig is base58. */
export function verifyWalletSignature(address: string, message: string, signatureB58: string): boolean {
  try {
    const pubkey = new PublicKey(address).toBytes();
    const sig = bs58.decode(signatureB58);
    const msg = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(msg, sig, pubkey);
  } catch {
    return false;
  }
}

export function isNonceFresh(issuedAt: number): boolean {
  return Date.now() - issuedAt < NONCE_TTL_MS && issuedAt <= Date.now() + 30_000;
}

/** Check the live on-chain balance against the gate threshold. */
export async function checkGateBalance(address: string): Promise<{ ok: boolean; balance: number }> {
  const balance = await getTokenBalanceForMint(address, GATE_MINT);
  return { ok: balance > GATE_MIN_BALANCE || (GATE_MIN_BALANCE === 0 && balance > 0), balance };
}

export async function issueSession(address: string, balance: number): Promise<string> {
  return new SignJWT({ address, balance })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(getSecret());
}

export async function verifySession(token: string | undefined): Promise<GateSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.address !== 'string') return null;
    return { address: payload.address, balance: Number(payload.balance ?? 0), exp: Number(payload.exp ?? 0) };
  } catch {
    return null;
  }
}
