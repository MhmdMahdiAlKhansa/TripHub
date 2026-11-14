export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export const RTL_LOCALES: readonly Locale[] = ['ar'];
export const CURRENCIES = ['USD', 'LBP'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const BRAND = {
  forestGreen: '#285C50',
  sage: '#8BAA96',
  warmOffWhite: '#F7F8F3',
  mistGreen: '#E6ECE5',
  deepPine: '#263C36',
} as const;
/** Platform-enforced maximum hold duration (minutes). Decision D-10. */
export const MAX_HOLD_MINUTES = 30;
export const DEFAULT_HOLD_MINUTES = 15;
/** When the operator collects deposits directly (no platform custody), a seat is held this long for the deposit. */
export const OPERATOR_DEPOSIT_HOURS = 48;
export const DEPOSIT_METHODS = ['WHISH', 'OMT', 'CASH'] as const;
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];
/** Deposit needed before a seat is secured, from the listing's percentage (rounded up to the minor unit). */
export const requiredDepositMinor = (totalMinor: bigint, depositPercent: number): bigint => (totalMinor * BigInt(depositPercent) + 99n) / 100n;
export const DEFAULT_TIMEZONE = 'Asia/Beirut';

export const CATEGORIES = ['hiking', 'tours', 'restaurants', 'museums', 'workshops', 'historical'] as const;
export type Category = (typeof CATEGORIES)[number];
export const COMPANY_LANGUAGES = ['en', 'ar', 'fr'] as const;
export const SOCIAL_KEYS = ['instagram', 'facebook', 'x', 'youtube', 'tiktok', 'whatsapp'] as const;
