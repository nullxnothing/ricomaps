'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useGate } from '@/hooks/useGate';

type GateContextValue = ReturnType<typeof useGate>;

const GateContext = createContext<GateContextValue | null>(null);

export function GateProvider({ children }: { children: ReactNode }) {
  const gate = useGate();
  return <GateContext.Provider value={gate}>{children}</GateContext.Provider>;
}

export function useGateContext(): GateContextValue {
  const ctx = useContext(GateContext);
  if (!ctx) throw new Error('useGateContext must be used within GateProvider');
  return ctx;
}
