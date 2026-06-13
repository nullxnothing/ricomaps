'use client';

export type RenderMode = 'default' | 'heatmap' | 'cluster';

interface ControlDockProps {
  isLive: boolean;
  liveCount: number;
  liveBusy?: boolean;
  onToggleLive: () => void;
  aiOpen: boolean;
  onToggleAi: () => void;
  mode: RenderMode;
  onSetMode: (mode: RenderMode) => void;
  zoomPct: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onExportPng: () => void;
  onExportCsv: () => void;
}

function IconBtn({ title, onClick, children, active }: { title: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button className={`dock-btn dock-btn--icon${active ? ' active' : ''}`} onClick={onClick} title={title} aria-label={title}>
      {children}
    </button>
  );
}

export function ControlDock({
  isLive, liveCount, liveBusy, onToggleLive,
  aiOpen, onToggleAi,
  mode, onSetMode,
  zoomPct, onZoomIn, onZoomOut, onFit,
  onExportPng, onExportCsv,
}: ControlDockProps) {
  return (
    <div className="control-dock">
      {/* Go Live */}
      <button className={`dock-btn${isLive ? ' active' : ''}`} onClick={onToggleLive} title="Stream live holder activity">
        <span
          className="inline-block w-2 h-2 rounded-full flex-shrink-0"
          style={
            isLive
              ? { background: 'var(--green-primary)', boxShadow: '0 0 8px var(--green-primary)', animation: 'rm-pulse 2s infinite' }
              : liveBusy
                ? { background: 'var(--amber-primary)', animation: 'rm-pulse 1s infinite' }
                : { background: 'var(--text-faint)' }
          }
        />
        {isLive ? `Live · ${liveCount}` : liveBusy ? 'Connecting…' : 'Go Live'}
      </button>

      <span className="dock-divider" />

      {/* AI read */}
      <button className={`dock-btn${aiOpen ? ' active' : ''}`} onClick={onToggleAi} title="AI read of this graph">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
          <path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" />
        </svg>
        AI read
      </button>

      <span className="dock-divider" />

      {/* Render modes */}
      <button className={`dock-btn${mode === 'heatmap' ? ' active' : ''}`} onClick={() => onSetMode(mode === 'heatmap' ? 'default' : 'heatmap')} title="Recolor by risk">
        Heatmap
      </button>
      <button className={`dock-btn${mode === 'cluster' ? ' active' : ''}`} onClick={() => onSetMode(mode === 'cluster' ? 'default' : 'cluster')} title="Recolor by cluster">
        Clusters
      </button>

      <span className="dock-divider" />

      {/* Zoom */}
      <IconBtn title="Zoom out" onClick={onZoomOut}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14" /></svg>
      </IconBtn>
      <span className="dock-zoom">{zoomPct}%</span>
      <IconBtn title="Zoom in" onClick={onZoomIn}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
      </IconBtn>
      <IconBtn title="Fit to view" onClick={onFit}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4M20 15v4a1 1 0 01-1 1h-4" />
        </svg>
      </IconBtn>

      <span className="dock-divider" />

      <button className="dock-btn" onClick={onExportPng} title="Download graph as PNG">PNG</button>
      <button className="dock-btn" onClick={onExportCsv} title="Download holders CSV">CSV</button>
    </div>
  );
}

export default ControlDock;
