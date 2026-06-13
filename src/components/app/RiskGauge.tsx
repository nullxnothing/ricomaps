'use client';

/**
 * 104×104 risk gauge: a 270° SVG ring filled to score/100, colored by band.
 * Lower score = safer (green ≤34, amber mid, red high).
 */
interface RiskGaugeProps {
  score: number; // 0–100
  color: string; // band color (CSS value)
  size?: number;
}

const SWEEP = 270; // degrees
const START = 135; // start angle (bottom-left), sweeping clockwise

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

export function RiskGauge({ score, color, size = 104 }: RiskGaugeProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 9;
  const clamped = Math.max(0, Math.min(100, score));
  const valueEnd = START + (SWEEP * clamped) / 100;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
      {/* Track */}
      <path d={arcPath(cx, cy, r, START, START + SWEEP)} fill="none" stroke="#1c1c28" strokeWidth="11" strokeLinecap="round" />
      {/* Value arc */}
      {clamped > 0 && (
        <path
          d={arcPath(cx, cy, r, START, valueEnd)}
          fill="none"
          stroke={color}
          strokeWidth="11"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${color}80)` }}
        />
      )}
      {/* Center label */}
      <text x={cx} y={cy - 2} textAnchor="middle" dominantBaseline="middle" fontFamily="var(--font-jetbrains-mono), monospace" fontSize="34" fontWeight="800" fill={color}>
        {Math.round(clamped)}
      </text>
      <text x={cx} y={cy + 18} textAnchor="middle" dominantBaseline="middle" fontFamily="var(--font-jetbrains-mono), monospace" fontSize="9" fill="#8a8a8a">
        /100
      </text>
    </svg>
  );
}

export default RiskGauge;
