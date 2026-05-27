import { ReactNode } from 'react';
import { Container } from './Container';

interface PageHeaderProps {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  align?: 'left' | 'center';
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  align = 'center',
}: PageHeaderProps) {
  const alignCls = align === 'center' ? 'text-center items-center' : 'text-left items-start';
  return (
    <section className="relative py-16 sm:py-20 border-b" style={{ borderColor: 'var(--border-base)' }}>
      <Container>
        <div className={`flex flex-col gap-4 ${alignCls}`}>
          {eyebrow && (
            <p
              className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {eyebrow}
            </p>
          )}
          <h1
            className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight leading-[1.1]"
            style={{ color: 'var(--text-primary)', letterSpacing: '-0.025em' }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              className="text-base sm:text-lg max-w-2xl leading-relaxed"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {subtitle}
            </p>
          )}
          {actions && <div className="flex flex-wrap gap-3 mt-2 justify-center">{actions}</div>}
        </div>
      </Container>
    </section>
  );
}
