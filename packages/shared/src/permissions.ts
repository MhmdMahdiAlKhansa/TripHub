export const PERMISSIONS = [
  'company.view',
  'company.profile.edit',
  'team.view',
  'team.manage',
  'listing.write',
  'listing.publish',
  'booking.view',
  'booking.manage',
  'booking.checkin',
  'payment.verify',
  'refund.request',
  'refund.approve',
  'billing.manage',
  'ai.use',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const COMPANY_ROLES = ['OWNER', 'MANAGER', 'BOOKING_STAFF', 'FINANCE'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

/** Deny by default: anything not listed is not allowed. Source of truth for the permission matrix. */
export const ROLE_PERMISSIONS: Record<CompanyRole, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  MANAGER: [
    'company.view',
    'company.profile.edit',
    'team.view',
    'listing.write',
    'listing.publish',
    'booking.view',
    'booking.manage',
    'booking.checkin',
    'refund.request',
    'ai.use',
  ],
  BOOKING_STAFF: [
    'company.view',
    'team.view',
    'booking.view',
    'booking.manage',
    'booking.checkin',
    'refund.request',
  ],
  FINANCE: [
    'company.view',
    'team.view',
    'booking.view',
    'payment.verify',
    'refund.request',
    'refund.approve',
    'billing.manage',
  ],
};

export function can(role: CompanyRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

// ---------------------------------------------------------------- platform (staff) roles

export const PLATFORM_ROLES = ['NONE', 'SUPPORT', 'VERIFIER', 'FINANCE', 'ADMIN'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_PERMISSIONS = [
  'company.review',
  'company.review.view',
  'payment.view',
  'payment.verify',
  'refund.view',
  'refund.decide',
  'subscription.view',
  'subscription.manage',
  'payout.view',
  'payout.manage',
  'review.moderate',
  'content.manage',
  'fx.manage',
  'ledger.view',
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, readonly PlatformPermission[]> = {
  NONE: [],
  SUPPORT: ['company.review.view', 'review.moderate', 'content.manage'],
  VERIFIER: ['company.review.view', 'company.review'],
  FINANCE: ['payment.view', 'payment.verify', 'refund.view', 'refund.decide', 'subscription.view', 'subscription.manage', 'payout.view', 'payout.manage', 'fx.manage', 'ledger.view'],
  ADMIN: ['company.review.view', 'company.review', 'payment.view', 'refund.view', 'subscription.view', 'payout.view', 'review.moderate', 'content.manage', 'fx.manage', 'ledger.view'],
};

export function platformCan(role: PlatformRole, permission: PlatformPermission): boolean {
  return PLATFORM_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
