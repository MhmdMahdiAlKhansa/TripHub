import { describe, expect, it } from 'vitest';
import { can, COMPANY_ROLES, PERMISSIONS, ROLE_PERMISSIONS } from './permissions';

describe('permission matrix', () => {
  it('owner holds every permission', () => {
    for (const p of PERMISSIONS) expect(can('OWNER', p)).toBe(true);
  });
  it('only the owner can manage the team', () => {
    for (const r of COMPANY_ROLES) expect(can(r, 'team.manage')).toBe(r === 'OWNER');
  });
  it('payment verification and refund approval are never granted to booking staff or managers', () => {
    for (const r of ['BOOKING_STAFF', 'MANAGER'] as const) {
      expect(can(r, 'payment.verify')).toBe(false);
      expect(can(r, 'refund.approve')).toBe(false);
    }
  });
  it('only listed permissions are valid (no unknown entries)', () => {
    for (const r of COMPANY_ROLES) for (const p of ROLE_PERMISSIONS[r]) expect(PERMISSIONS).toContain(p);
  });
  it('denies unknown roles', () => {
    expect(can('NOPE' as never, 'company.view')).toBe(false);
  });
});

import { platformCan } from './permissions';

describe('platform permissions', () => {
  it('only verifiers and admins can review companies', () => {
    expect(platformCan('VERIFIER', 'company.review')).toBe(true);
    expect(platformCan('ADMIN', 'company.review')).toBe(true);
    for (const r of ['NONE', 'SUPPORT', 'FINANCE'] as const) expect(platformCan(r, 'company.review')).toBe(false);
  });
  it('support may view but not decide', () => {
    expect(platformCan('SUPPORT', 'company.review.view')).toBe(true);
    expect(platformCan('SUPPORT', 'company.review')).toBe(false);
  });
  it('unknown roles are denied', () => {
    expect(platformCan('X' as never, 'company.review.view')).toBe(false);
  });
});

describe('payment permissions', () => {
  it('only finance can verify payments; admins can view but not verify', () => {
    expect(platformCan('FINANCE', 'payment.verify')).toBe(true);
    for (const r of ['NONE', 'SUPPORT', 'VERIFIER', 'ADMIN'] as const) expect(platformCan(r, 'payment.verify')).toBe(false);
    expect(platformCan('ADMIN', 'payment.view')).toBe(true);
  });
  it('verifiers cannot see payments or the ledger', () => {
    expect(platformCan('VERIFIER', 'payment.view')).toBe(false);
    expect(platformCan('VERIFIER', 'ledger.view')).toBe(false);
  });
});
