/**
 * Brand crosshair/radar glyph used inside the top-bar chip.
 * Concentric ring + center dot + 4 ticks, matrix green.
 */
export function BrandMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#00FF41" strokeWidth="1.6">
      <circle cx="12" cy="12" r="8" opacity="0.9" />
      <circle cx="12" cy="12" r="1.6" fill="#00FF41" stroke="none" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
    </svg>
  );
}

export default BrandMark;
