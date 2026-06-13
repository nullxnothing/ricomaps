'use client';

import { useState, useEffect, useCallback } from 'react';
import bs58 from 'bs58';

interface SolanaProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array }>;
}

function getProvider(): SolanaProvider | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { solana?: SolanaProvider; solflare?: SolanaProvider };
  return w.solana ?? w.solflare ?? null;
}

interface GateState {
  unlocked: boolean;
  address: string | null;
  loading: boolean;
  error: string | null;
}

export function useGate() {
  const [state, setState] = useState<GateState>({ unlocked: false, address: null, loading: true, error: null });

  // Read existing session on mount (cheap cookie check, no chain call).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/gate/session')
      .then(r => r.json())
      .then(d => { if (!cancelled) setState(s => ({ ...s, unlocked: !!d.unlocked, address: d.address ?? null, loading: false })); })
      .catch(() => { if (!cancelled) setState(s => ({ ...s, loading: false })); });
    return () => { cancelled = true; };
  }, []);

  const unlock = useCallback(async () => {
    const provider = getProvider();
    if (!provider) {
      setState(s => ({ ...s, error: 'No Solana wallet found. Install Phantom or Solflare.' }));
      return false;
    }

    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const { publicKey } = await provider.connect();
      const address = publicKey.toString();

      const nonceRes = await fetch('/api/gate/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const { message, nonce, issuedAt, error } = await nonceRes.json();
      if (!message) throw new Error(error || 'Failed to start verification');

      const encoded = new TextEncoder().encode(message);
      const { signature } = await provider.signMessage(encoded, 'utf8');
      const signatureB58 = bs58.encode(signature);

      const verifyRes = await fetch('/api/gate/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature: signatureB58, nonce, issuedAt }),
      });
      const verify = await verifyRes.json();

      if (!verify.success) {
        const msg = verify.error === 'no_balance'
          ? 'This wallet holds no $RICO: heavier features are holder-only.'
          : (verify.message || verify.error || 'Verification failed');
        setState(s => ({ ...s, loading: false, error: msg }));
        return false;
      }

      setState({ unlocked: true, address, loading: false, error: null });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Wallet connection failed';
      setState(s => ({ ...s, loading: false, error: msg.includes('User rejected') ? 'Signature cancelled' : msg }));
      return false;
    }
  }, []);

  const lock = useCallback(async () => {
    await fetch('/api/gate/session', { method: 'DELETE' }).catch(() => {});
    setState({ unlocked: false, address: null, loading: false, error: null });
  }, []);

  return { ...state, unlock, lock };
}
