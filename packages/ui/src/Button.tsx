import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const base =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold ' +
  'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--brand)] text-[var(--on-brand)] hover:bg-[var(--brand-hover)]',
  secondary: 'bg-[var(--surface-2)] text-[var(--fg)] hover:bg-[var(--surface-3)]',
  ghost: 'bg-transparent text-[var(--fg)] hover:bg-[var(--surface-2)]',
};

export function buttonClass(variant: ButtonVariant = 'primary', extra?: string): string {
  return cx(base, variants[variant], extra);
}

export function Button({
  variant = 'primary',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; children: ReactNode }) {
  return (
    <button className={buttonClass(variant, className)} {...rest}>
      {children}
    </button>
  );
}
