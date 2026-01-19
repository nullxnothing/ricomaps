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
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="text-center">
        <div className="spinner-lg mx-auto mb-4" />
        <p className="text-[#e34946] text-lg mb-2">Scanning</p>
        <p className="text-[#9898a6] text-sm">{message || defaultMessage}</p>
      </div>
    </div>
  );
}

export default LoadingOverlay;
