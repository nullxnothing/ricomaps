'use client';

import { useState, useCallback } from 'react';
import { isValidSolanaAddress } from '@/lib/address-utils';

interface AddressInputProps {
  onSubmit: (address: string) => void;
  isLoading: boolean;
  isDetecting?: boolean;
  size?: 'normal' | 'large';
}

export function AddressInput({ onSubmit, isLoading, isDetecting, size = 'normal' }: AddressInputProps) {
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = address.trim();

    if (!trimmed) {
      setError('Please enter an address');
      return;
    }

    if (!isValidSolanaAddress(trimmed)) {
      setError('Invalid Solana address');
      return;
    }

    onSubmit(trimmed);
  }, [address, onSubmit]);

  const isLarge = size === 'large';
  const containerClass = isLarge ? 'w-full max-w-2xl' : 'w-full';
  const inputClass = isLarge ? 'input input-large flex-1 min-w-0 text-sm sm:text-base' : 'input flex-1 min-w-0 text-xs';
  const buttonClass = isLarge ? 'btn-primary btn-large whitespace-nowrap flex-shrink-0' : 'btn-primary whitespace-nowrap flex-shrink-0 text-xs px-2.5 sm:px-3 py-1.5';

  const getButtonText = () => {
    if (isDetecting) {
      return (
        <span className="flex items-center gap-2">
          <span className="spinner" />
          Detecting...
        </span>
      );
    }
    if (isLoading) {
      return (
        <span className="flex items-center gap-2">
          <span className="spinner" />
          Scanning...
        </span>
      );
    }
    return 'Scan';
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
            placeholder={isLarge ? "Search Tokens or Wallets (Name, Ticker, Address)" : "Search address..."}
            className={inputClass}
            disabled={isLoading || isDetecting}
          />
          <button
            type="submit"
            className={buttonClass}
            disabled={isLoading || isDetecting || !address.trim()}
          >
            {getButtonText()}
          </button>
        </div>
        {error && (
          <p className="text-xs" style={{ color: 'var(--red-primary)' }}>{error}</p>
        )}
      </div>
    </form>
  );
}

export default AddressInput;
