import Link from 'next/link';
import type { ReactNode } from 'react';
import { siteConfig } from '@/site.config';

/** Narrow centered column. */
export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-content px-5 sm:px-8 ${className}`}>{children}</div>;
}

/** Vertical section rhythm (desktop 96–128px, compact on mobile). */
export function Section({
  children,
  id,
  className = '',
  labelledBy,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: {
  children: ReactNode;
  id?: string;
  className?: string;
  labelledBy?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  return (
    <section
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy ?? labelledBy}
      className={`py-16 sm:py-20 lg:py-28 ${className}`}
    >
      <Container>{children}</Container>
    </section>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'md' | 'lg' | 'block';

/** Link-styled actions only — never use for form submission yet (no handler exists). */
export function Button({
  href,
  children,
  variant = 'primary',
  size = 'md',
  className = '',
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-cta font-semibold transition-opacity duration-200 hover:opacity-90';
  const variants: Record<ButtonVariant, string> = {
    // White on terracotta — large/bold usage only (4.5:1 boundary, see MKT-01A report).
    primary: 'bg-clay text-white',
    secondary: 'border border-line bg-paper text-ink hover:border-ink-soft/40',
    ghost: 'text-clay-dark underline-offset-4 hover:underline',
  };
  const sizes: Record<ButtonSize, string> = {
    md: 'px-5 py-3 text-base',
    lg: 'px-7 py-4 text-lg',
    block: 'w-full px-5 py-4 text-lg',
  };
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </Link>
  );
}

/** Small factual label chip — never for invented statistics. */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-sand px-3 py-1 text-sm font-medium text-ink-soft">
      {children}
    </span>
  );
}

/** Page head block: one logical h1 + lede. */
export function PageShell({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  children?: ReactNode;
}) {
  return (
    <div className="pb-8 pt-14 sm:pt-20">
      <Container>
        {eyebrow ? <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-teal">{eyebrow}</p> : null}
        <h1 className="max-w-3xl font-display text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-5xl">{title}</h1>
        {lede ? <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-soft">{lede}</p> : null}
        {children}
      </Container>
    </div>
  );
}
