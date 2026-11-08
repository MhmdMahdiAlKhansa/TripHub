import type { Locale } from '@triphub/shared';
import ar from '../messages/ar.json';
import en from '../messages/en.json';

export type MessageKey = keyof typeof en;
const catalogs: Record<Locale, Record<string, string>> = { en, ar };

export function createT(locale: Locale) {
  const table = catalogs[locale];
  return (key: MessageKey): string => table[key] ?? catalogs.en[key] ?? key;
}
export type T = ReturnType<typeof createT>;

export const allCatalogs = catalogs;
