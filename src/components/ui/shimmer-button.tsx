import React, { type ComponentPropsWithoutRef, type CSSProperties } from 'react';

import { cn } from '@/lib/utils';

export interface ShimmerButtonProps extends ComponentPropsWithoutRef<'button'> {
  shimmerColor?: string;
  shimmerSize?: string;
  borderRadius?: string;
  shimmerDuration?: string;
  background?: string;
  className?: string;
  children?: React.ReactNode;
}

export const ShimmerButton = React.forwardRef<HTMLButtonElement, ShimmerButtonProps>(
  (
    {
      shimmerColor = '#ffffff',
      shimmerSize = '0.05em',
      shimmerDuration = '3s',
      borderRadius = '100px',
      background = 'rgba(0, 0, 0, 1)',
      className,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        style={
          {
            '--spread': '90deg',
            '--shimmer-color': shimmerColor,
            '--radius': borderRadius,
            '--speed': shimmerDuration,
            '--cut': shimmerSize,
            '--bg': background,
            borderRadius: borderRadius,
          } as CSSProperties
        }
        className={cn(
          'group relative isolate cursor-pointer inline-flex items-center justify-center overflow-hidden whitespace-nowrap border border-white/10 px-6 py-3 text-white',
          'transform-gpu transition-transform duration-200 ease-in-out active:translate-y-px',
          className,
        )}
        ref={ref}
        {...props}
      >
        {/* Inner background fill (sits above the rotating spark) */}
        <span
          aria-hidden="true"
          className="absolute inset-px -z-10"
          style={{
            background,
            borderRadius: `calc(${borderRadius} - 1px)`,
          }}
        />

        {/* Rotating conic-gradient spark — clipped by parent's overflow-hidden */}
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-20 overflow-hidden"
          style={{ borderRadius: borderRadius }}
        >
          <span
            className="animate-spin-around absolute left-1/2 top-1/2 aspect-square w-[200%] -translate-x-1/2 -translate-y-1/2"
            style={{
              background:
                'conic-gradient(from calc(270deg - (var(--spread) * 0.5)), transparent 0, var(--shimmer-color) var(--spread), transparent var(--spread))',
            }}
          />
        </span>

        {/* Subtle inner highlight */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 shadow-[inset_0_-8px_10px_#ffffff1f] transition-shadow duration-200 group-hover:shadow-[inset_0_-6px_10px_#ffffff3f] group-active:shadow-[inset_0_-10px_10px_#ffffff3f]"
          style={{ borderRadius: borderRadius }}
        />

        {/* Content */}
        <span className="relative z-10 inline-flex items-center gap-1.5">{children}</span>
      </button>
    );
  },
);

ShimmerButton.displayName = 'ShimmerButton';
