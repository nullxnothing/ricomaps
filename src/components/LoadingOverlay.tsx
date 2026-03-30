'use client';

import { AppMode } from '@/lib/types';

interface LoadingOverlayProps {
  isLoading: boolean;
  mode: AppMode;
  message?: string;
}

export function LoadingOverlay({ isLoading, mode, message }: LoadingOverlayProps) {
  if (!isLoading) return null;

  const defaultMessage = mode === 'wallet'
    ? 'Tracing funding chain...'
    : 'Mapping token holders...';

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" style={{ WebkitBackdropFilter: 'blur(4px)', backdropFilter: 'blur(4px)' }}>
      <div className="text-center">
        <div className="spinner-lg mx-auto mb-4" />
        <p className="text-lg mb-2" style={{ color: 'var(--green-primary)' }}>Scanning</p>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{message || defaultMessage}</p>
      </div>
    </div>
  );
}

export default LoadingOverlay;
