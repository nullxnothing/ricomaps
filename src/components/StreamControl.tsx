'use client';

interface StreamControlProps {
  isStreaming: boolean;
  isConnecting: boolean;
  watchedCount: number;
  transactionCount: number;
  error?: string | null;
  onToggle: () => void;
}

export function StreamControl({
  isStreaming,
  isConnecting,
  watchedCount,
  transactionCount,
  error,
  onToggle,
}: StreamControlProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onToggle}
        disabled={isConnecting}
        className={`
          flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-medium
          transition-all duration-200 border
          ${isStreaming
            ? 'bg-[#22c55e]/10 border-[#22c55e]/50 text-[#22c55e] hover:bg-[#22c55e]/20'
            : 'bg-[#1a1a24] border-[#2a2a3a] text-[#6b7280] hover:border-[#4a9eff] hover:text-[#4a9eff]'
          }
          ${isConnecting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        {isConnecting ? (
          <>
            <div className="w-2 h-2 border border-[#f59e0b] border-t-transparent rounded-full animate-spin" />
            <span>CONNECTING</span>
          </>
        ) : isStreaming ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22c55e]" />
            </span>
            <span>LIVE</span>
            {watchedCount > 0 && (
              <span className="text-[10px] text-[#22c55e]/60">({watchedCount})</span>
            )}
          </>
        ) : (
          <>
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" />
            </svg>
            <span>REAL-TIME</span>
          </>
        )}
      </button>

      {/* Transaction counter when streaming */}
      {isStreaming && transactionCount > 0 && (
        <div className="text-[10px] text-[#22c55e]/60 font-mono">
          +{transactionCount} tx
        </div>
      )}

      {/* Error indicator */}
      {error && (
        <div className="text-[10px] text-[#ff3366] font-mono" title={error}>
          ERR
        </div>
      )}
    </div>
  );
}

export default StreamControl;
