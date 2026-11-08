import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx('rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm', className)}
      {...rest}
    />
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <Card className="text-center">
      <p className="text-lg font-semibold">{title}</p>
      {body ? <p className="mt-2 text-[var(--muted)]">{body}</p> : null}
    </Card>
  );
}
