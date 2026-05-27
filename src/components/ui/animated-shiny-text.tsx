import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type FC,
} from 'react';

import { cn } from '@/lib/utils';

export interface AnimatedShinyTextProps extends ComponentPropsWithoutRef<'span'> {
  shimmerWidth?: number;
}

export const AnimatedShinyText: FC<AnimatedShinyTextProps> = ({
  children,
  className,
  shimmerWidth = 100,
  ...props
}) => {
  return (
    <span
      style={
        {
          '--shiny-width': `${shimmerWidth}px`,
          color: 'transparent',
          WebkitTextFillColor: 'transparent',
          backgroundImage:
            'linear-gradient(90deg, var(--text-tertiary) 0%, var(--text-tertiary) 40%, #ffffff 50%, var(--text-tertiary) 60%, var(--text-tertiary) 100%)',
          backgroundSize: 'var(--shiny-width) 100%',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: '0 0',
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
        } as CSSProperties
      }
      className={cn('inline-block animate-shiny-text', className)}
      {...props}
    >
      {children}
    </span>
  );
};
