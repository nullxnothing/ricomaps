'use client';

/**
 * Top-left glass legend explaining the bubble encoding. Static — the encoding
 * doesn't change with the data, only what's present.
 */
const ROWS: { swatch: React.ReactNode; label: string }[] = [
  {
    swatch: (
      <span className="flex items-center gap-[3px]">
        <span className="w-[7px] h-[7px] rounded-full" style={{ background: '#a78bfa' }} />
        <span className="w-[7px] h-[7px] rounded-full" style={{ background: '#22d3ee' }} />
        <span className="w-[7px] h-[7px] rounded-full" style={{ background: '#f472b6' }} />
      </span>
    ),
    label: 'Bundle · each colour = 1 crew',
  },
  { swatch: <span className="w-[9px] h-[9px] rounded-full" style={{ background: '#00FF41' }} />, label: 'Lone holder' },
  { swatch: <span className="w-[9px] h-[9px] rounded-full" style={{ background: '#22d3ee' }} />, label: 'Sniper' },
  { swatch: <span className="w-[9px] h-[9px] rounded-full" style={{ background: '#9aa3b2' }} />, label: 'Liquidity pool' },
  {
    swatch: <span className="w-[9px] h-[9px] rounded-full" style={{ background: '#00FF41', boxShadow: '0 0 6px #00FF41' }} />,
    label: 'Token',
  },
];

export function GraphLegend() {
  return (
    <div className="glass-legend select-none" role="group" aria-label="Graph legend">
      <div className="flex flex-col gap-[7px]">
        {ROWS.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            <span className="flex items-center justify-center w-[18px] flex-shrink-0">{r.swatch}</span>
            <span className="text-[11px] text-[#b8b8b8]">{r.label}</span>
          </div>
        ))}
      </div>
      <div className="text-[9.5px] text-text-faint mt-2">Bigger node in a clump = the funder wallet</div>
    </div>
  );
}

export default GraphLegend;
