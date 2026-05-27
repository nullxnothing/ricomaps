'use client';

import { useState, useCallback } from 'react';
import { isValidSolanaAddress } from '@/lib/address-utils';

interface AddressInputProps {
  onSubmit: (address: string) => void;
  isLoading: boolean;
  isDetecting?: boolean;
  size?: 'normal' | 'large';
}

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function AddressInput({ onSubmit, isLoading, isDetecting, size = 'normal' }: AddressInputProps) {
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const trimmed = address.trim();
  const hasInvalidFormat = touched && trimmed.length > 0 && !SOLANA_ADDRESS_REGEX.test(trimmed);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTouched(true);

    const val = address.trim();

    if (!val) {
      setError('Please enter an address');
      return;
    }

    if (!SOLANA_ADDRESS_REGEX.test(val)) {
      setError('Invalid Solana address');
      return;
    }

    if (!isValidSolanaAddress(val)) {
      setError('Invalid Solana address');
      return;
    }

    onSubmit(val);
  }, [address, onSubmit]);

  const isLarge = size === 'large';
  const containerClass = isLarge ? 'w-full max-w-2xl' : 'w-full';
  const inputClass = isLarge ? 'input input-large flex-1 min-w-0 text-sm sm:text-base' : 'input flex-1 min-w-0 text-xs';
  const buttonClass = isLarge ? 'btn-primary btn-large whitespace-nowrap flex-shrink-0' : 'btn-primary whitespace-nowrap flex-shrink-0 text-xs px-2.5 sm:px-3 py-1.5';

  const getButtonContent = () => {
    if (isDetecting) {
      return (
        <span className="flex items-center gap-2">
          <span className="spinner" />
          <span className="hidden sm:inline">Detecting...</span>
        </span>
      );
    }
    if (isLoading) {
      return (
        <span className="flex items-center gap-2">
          <span className="spinner" />
          <span className="hidden sm:inline">Scanning...</span>
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <span>Scan</span>
      </span>
    );
  };

  return (
    <form onSubmit={handleSubmit} className={containerClass}>
      <div className="flex flex-col gap-2">
        <div className={isLarge ? 'flex gap-3' : 'flex gap-2'}>
          <input
            type="text"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setError(null);
            }}
            onBlur={() => setTouched(true)}
            placeholder={isLarge ? "Search tokens or wallets..." : "Search address..."}
            className={`${inputClass}${hasInvalidFormat ? ' border-red-500/50' : ''}`}
            disabled={isLoading || isDetecting}
          />
          <button
            type="submit"
            className={buttonClass}
            disabled={isLoading || isDetecting || !address.trim() || hasInvalidFormat}
          >
            {getButtonContent()}
          </button>
        </div>
        {(error || hasInvalidFormat) && (
          <p className="text-xs" style={{ color: 'var(--red-primary)' }}>{error || 'Invalid address format'}</p>
        )}
      </div>
    </form>
  );
}

export default AddressInput;
