'use client';

import { useState, useEffect, useCallback } from 'react';
import bs58 from 'bs58';
import { needsMobileWalletDeepLink, openInWallet, type MobileWallet } from '@/lib/mobile-wallet';

interface SolanaProvider {
  isPhantom?: boolean;
  // Phantom returns { publicKey } from connect(); Solflare resolves without it and
  // exposes the key on provider.publicKey instead — so both are optional here.
  publicKey?: { toString(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey?: { toString(): string } } | void>;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array } | Uint8Array>;
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
  /** Set when the user is on mobile with no injected wallet; UI should show
   *  "Open in Phantom/Solflare" deep-link buttons instead of an error. */
  needsMobileWallet: boolean;
}

export function useGate() {
  const [state, setState] = useState<GateState>({ unlocked: false, address: null, loading: true, error: null, needsMobileWallet: false });

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
      // On a phone with no extension the only path to a wallet is the in-app
      // browser — surface deep-link buttons rather than a dead-end error.
      if (needsMobileWalletDeepLink()) {
        setState(s => ({ ...s, loading: false, needsMobileWallet: true, error: null }));
        return false;
      }
      setState(s => ({ ...s, error: 'No Solana wallet found. Install Phantom or Solflare.' }));
      return false;
    }

    setState(s => ({ ...s, loading: true, error: null, needsMobileWallet: false }));
    try {
      // Phantom returns { publicKey }; Solflare resolves void and sets
      // provider.publicKey. Read whichever is present and bail clearly if neither.
      const res = await provider.connect();
      const key = res?.publicKey ?? provider.publicKey;
      if (!key) throw new Error('Wallet did not return an address. Try reconnecting.');
      const address = key.toString();

      const nonceRes = await fetch('/api/gate/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const { message, nonce, issuedAt, error } = await nonceRes.json();
      if (!message) throw new Error(error || 'Failed to start verification');

      const encoded = new TextEncoder().encode(message);
      // Phantom/Solflare return { signature }; some wallets return the bytes
      // directly. Unwrap either and verify we got bytes before encoding.
      const signed = await provider.signMessage(encoded, 'utf8');
      const sigBytes = (signed as { signature?: Uint8Array })?.signature ?? (signed as unknown as Uint8Array);
      if (!sigBytes || !(sigBytes instanceof Uint8Array)) throw new Error('Wallet returned no signature.');
      const signatureB58 = bs58.encode(sigBytes);

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

      setState({ unlocked: true, address, loading: false, error: null, needsMobileWallet: false });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Wallet connection failed';
      setState(s => ({ ...s, loading: false, error: msg.includes('User rejected') ? 'Signature cancelled' : msg }));
      return false;
    }
  }, []);

  const lock = useCallback(async () => {
    await fetch('/api/gate/session', { method: 'DELETE' }).catch(() => {});
    setState({ unlocked: false, address: null, loading: false, error: null, needsMobileWallet: false });
  }, []);

  // Deep-link into a wallet's in-app browser, then the page reloads there with
  // an injected provider and the user retries unlock normally.
  const openWallet = useCallback((wallet: MobileWallet) => {
    openInWallet(wallet);
  }, []);

  const dismissMobileWallet = useCallback(() => {
    setState(s => ({ ...s, needsMobileWallet: false }));
  }, []);

  return { ...state, unlock, lock, openWallet, dismissMobileWallet };
}
