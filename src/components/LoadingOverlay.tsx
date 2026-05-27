'use client';

import { useState, useEffect, useRef } from 'react';
import { AppMode } from '@/lib/types';

interface LoadingOverlayProps {
  isLoading: boolean;
  mode: AppMode;
  message?: string;
}

const STAGES_TOKEN = [
  { label: 'Fetching token data', delay: 0 },
  { label: 'Analyzing holders', delay: 1200 },
  { label: 'Tracing funding chains', delay: 3000 },
  { label: 'Detecting cabal clusters', delay: 5500 },
  { label: 'Building graph', delay: 8000 },
];

const STAGES_WALLET = [
  { label: 'Resolving address', delay: 0 },
  { label: 'Tracing funding chain', delay: 800 },
  { label: 'Mapping connections', delay: 2500 },
  { label: 'Building graph', delay: 5000 },
];

export function LoadingOverlay({ isLoading, mode, message }: LoadingOverlayProps) {
  const [currentStage, setCurrentStage] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stages = mode === 'token' ? STAGES_TOKEN : STAGES_WALLET;

  useEffect(() => {
    if (isLoading) {
      // Clear previous timers
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];

      const showTimer = setTimeout(() => {
        setCurrentStage(0);
        setIsVisible(true);
      }, 0);
      timersRef.current.push(showTimer);

      // Schedule stage transitions
      stages.forEach((stage, i) => {
        if (i > 0) {
          const timer = setTimeout(() => setCurrentStage(i), stage.delay);
          timersRef.current.push(timer);
        }
      });
    } else {
      // Fade out
      const timer = setTimeout(() => {
        setIsVisible(false);
        setCurrentStage(0);
      }, 300);
      timersRef.current.push(timer);
    }

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [isLoading, stages]);

  if (!isLoading && !isVisible) return null;

  const progress = ((currentStage + 1) / stages.length) * 100;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300"
      style={{
        background: 'rgba(0,0,0,0.85)',
        WebkitBackdropFilter: 'blur(8px)',
        backdropFilter: 'blur(8px)',
        opacity: isLoading ? 1 : 0,
        pointerEvents: isLoading ? 'auto' : 'none',
      }}
    >
      <div className="flex flex-col items-center gap-6 max-w-xs px-6">
        {/* Animated scanner ring */}
        <div className="relative w-16 h-16">
          <svg className="w-16 h-16 animate-spin" style={{ animationDuration: '2s' }} viewBox="0 0 64 64">
            <circle
              cx="32" cy="32" r="28"
              fill="none"
              stroke="#1f1f1f"
              strokeWidth="3"
            />
            <circle
              cx="32" cy="32" r="28"
              fill="none"
              stroke="var(--green-primary)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="60 120"
              style={{ filter: 'drop-shadow(0 0 6px rgba(0,255,65,0.4))' }}
            />
          </svg>
          <div
            className="absolute inset-0 flex items-center justify-center text-xs font-mono font-bold"
            style={{ color: 'var(--green-primary)' }}
          >
            {Math.round(progress)}%
          </div>
        </div>

        {/* Stage label */}
        <div className="text-center">
          <p
            className="text-sm font-medium mb-2 transition-opacity duration-200"
            style={{ color: 'var(--text-primary)' }}
            key={currentStage}
          >
            {message || stages[currentStage].label}
          </p>

          {/* Progress bar */}
          <div
            className="w-48 h-1 rounded-full overflow-hidden mx-auto"
            style={{ background: 'var(--border-base)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${progress}%`,
                background: 'linear-gradient(90deg, var(--green-primary), var(--green-dim))',
                boxShadow: '0 0 8px rgba(0,255,65,0.3)',
              }}
            />
          </div>

          {/* Stage dots */}
          <div className="flex items-center justify-center gap-1.5 mt-3">
            {stages.map((_, i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full transition-all duration-300"
                style={{
                  background: i <= currentStage ? 'var(--green-primary)' : '#333',
                  boxShadow: i === currentStage ? '0 0 6px rgba(0,255,65,0.5)' : 'none',
                  transform: i === currentStage ? 'scale(1.3)' : 'scale(1)',
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoadingOverlay;
