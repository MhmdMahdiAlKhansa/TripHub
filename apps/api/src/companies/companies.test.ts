import 'reflect-metadata';
import * as OTPAuth from 'otpauth';
import { createPrismaClient, PrismaClient } from '@triphub/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, PASSWORD, slug, type Harness, type TestUser } from '../testing/harness';
import { missingForSubmission } from './profile';

let h: Harness;
let db: PrismaClient;
beforeAll(async () => {
  h = await createHarness();
  db = createPrismaClient();
});
afterAll(async () => {
  await h.close();
  await db.$disconnect();
});

const COMPLETE = {
  description: 'Guided day hikes through the Qadisha Valley with local mountain guides.',
  contactEmail: 'hello@cedar-treks.example',
  phone: '+961 3 123 456',
  city: 'Bsharri',
  categories: ['hiking', 'tours'],
  languages: ['en', 'ar'],
};

async function newCompany(owner: TestUser) {
  const r = await h.http().post('/api/v1/companies').set('Cookie', owner.cookie)
    .send({ name: 'Cedar Treks', slug: slug() }).expect(201);
  return r.body.company.id as string;
}
const patch = (cookie: string, id: string, body: object) =>
  h.http().patch(`/api/v1/companies/${id}/profile`).set('Cookie', cookie).send(body);
const submit = (cookie: string, id: string) => h.http().post(`/api/v1/companies/${id}/submit`).set('Cookie', cookie);

async function readyCompany() {
  const owner = await h.newUser();
  const id = await newCompany(owner);
  await patch(owner.cookie, id, COMPLETE).expect(200);
  return { owner, id };
}

async function staff(role: 'SUPPORT' | 'VERIFIER' | 'ADMIN', withMfa = true): Promise<TestUser> {
  const u = await h.newUser();
  await db.user.update({ where: { id: u.id }, data: { platformRole: role } });
  if (withMfa) {
    const { body } = await h.http().post('/api/v1/auth/mfa/setup').set('Cookie', u.cookie).expect(200);
    const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(body.secret), digits: 6, period: 30 }).generate();
    await h.http().post('/api/v1/auth/mfa/enable').set('Cookie', u.cookie).send({ code }).expect(200);
  }
  return u;
}
const review = (cookie: string, id: string, body: object) =>
  h.http().post(`/api/v1/admin/companies/${id}/review`).set('Cookie', cookie).send(body);

describe('profile editing', () => {
  it('starts empty in DRAFT and saves partial updates', async () => {
    const owner = await h.newUser();
    const id = await newCompany(owner);
    const before = await h.http().get(`/api/v1/companies/${id}/profile`).set('Cookie', owner.cookie).expect(200);
    expect(before.body.company).toMatchObject({ status: 'DRAFT', description: null, categories: [], onboardingStep: 1 });

    const res = await patch(owner.cookie, id, {
      city: 'Beirut', categories: ['museums'], latitude: 33.8938, longitude: 35.5018,
      socials: { instagram: 'https://instagram.com/example' }, onboardingStep: 3,
    }).expect(200);
    expect(res.body.company).toMatchObject({ city: 'Beirut', categories: ['museums'], latitude: 33.8938, onboardingStep: 3 });
    // Untouched fields stay as they were.
    expect(res.body.company.name).toBe('Cedar Treks');
  });

  it('rejects invalid, unsafe and unknown input', async () => {
    const owner = await h.newUser();
    const id = await newCompany(owner);
    for (const bad of [
      { contactEmail: 'not-an-email' },
      { phone: 'abc' },
      { website: 'http://insecure.example' },
      { website: 'javascript:alert(1)' },
      { socials: { instagram: 'javascript:alert(1)' } },
      { socials: { myspace: 'https://x.example' } },
      { latitude: 33.9 },
      { latitude: 120, longitude: 10 },
      { categories: ['skydiving'] },
      { status: 'APPROVED' }, // cannot self-approve through the profile endpoint
      { id: 'x' },
    ]) {
      await patch(owner.cookie, id, bad).expect(400);
    }
    const row = await db.company.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('DRAFT');
  });

  it('only roles with company.profile.edit may edit; only owners may submit', async () => {
    const { owner, id } = await readyCompany();
    const mgr = await h.newUser();
    const staffMember = await h.newUser();
    for (const [u, role] of [[mgr, 'MANAGER'], [staffMember, 'BOOKING_STAFF']] as const) {
      await h.http().post(`/api/v1/companies/${id}/invitations`).set('Cookie', owner.cookie).send({ email: u.email, role }).expect(202);
      await h.http().post('/api/v1/invitations/accept').set('Cookie', u.cookie)
        .send({ token: h.lastToken(u.email, 'company-invitation') }).expect(200);
    }
    await patch(mgr.cookie, id, { city: 'Jounieh' }).expect(200);
    await patch(staffMember.cookie, id, { city: 'Tyre' }).expect(403);
    await submit(mgr.cookie, id).expect(403);
    expect((await db.company.findUniqueOrThrow({ where: { id } })).city).toBe('Jounieh');
  });
});

describe('submission for verification', () => {
  it('lists what is missing for an incomplete profile (422)', async () => {
    const owner = await h.newUser();
    const id = await newCompany(owner);
    const res = await submit(owner.cookie, id).expect(422);
    expect(res.body.code).toBe('incomplete_profile');
    expect(res.body.missing).toEqual(
      expect.arrayContaining(['description', 'contactEmail', 'phone', 'city', 'categories', 'languages']),
    );
    expect((await db.company.findUniqueOrThrow({ where: { id } })).status).toBe('DRAFT');
  });

  it('moves a complete profile to PENDING_REVIEW and locks editing', async () => {
    const { owner, id } = await readyCompany();
    const res = await submit(owner.cookie, id).expect(200);
    expect(res.body.company.status).toBe('PENDING_REVIEW');
    expect(res.body.company.submittedAt).toBeTruthy();
    const locked = await patch(owner.cookie, id, { city: 'Sidon' }).expect(409);
    expect(locked.body.code).toBe('profile_locked');
    await submit(owner.cookie, id).expect(409);
  });

  it('concurrent submits produce exactly one transition', async () => {
    const { owner, id } = await readyCompany();
    const rs = await Promise.all([1, 2, 3].map(() => submit(owner.cookie, id)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await db.auditEvent.count({ where: { companyId: id, action: 'company.submitted' } })).toBe(1);
  });

  it('missingForSubmission is exact about thresholds', () => {
    const base = { name: 'AB', description: 'x'.repeat(30), contactEmail: 'a@b.c', phone: '1', city: 'c', categories: ['hiking'], languages: ['en'] };
    expect(missingForSubmission(base)).toEqual([]);
    expect(missingForSubmission({ ...base, description: 'x'.repeat(29) })).toEqual(['description']);
    expect(missingForSubmission({ ...base, name: ' a ' })).toEqual(['name']);
  });
});

describe('platform verification', () => {
  it('hides admin routes from ordinary users (404) and unauthenticated callers (401)', async () => {
    const u = await h.newUser();
    await h.http().get('/api/v1/admin/companies').expect(401);
    await h.http().get('/api/v1/admin/companies').set('Cookie', u.cookie).expect(404);
  });

  it('staff without MFA are refused, even verifiers', async () => {
    const v = await staff('VERIFIER', false);
    const res = await h.http().get('/api/v1/admin/companies').set('Cookie', v.cookie).expect(403);
    expect(res.body.code).toBe('mfa_required_for_staff');
  });

  it('support can view the queue but cannot decide', async () => {
    const { owner, id } = await readyCompany();
    await submit(owner.cookie, id).expect(200);
    const s = await staff('SUPPORT');
    const list = await h.http().get('/api/v1/admin/companies').set('Cookie', s.cookie).expect(200);
    expect(list.body.companies.map((c: { id: string }) => c.id)).toContain(id);
    await review(s.cookie, id, { decision: 'APPROVED' }).expect(403);
    expect((await db.company.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING_REVIEW');
  });

  it('verifier approves: status, timestamp, review history and audit are recorded; name then locked', async () => {
    const { owner, id } = await readyCompany();
    await submit(owner.cookie, id).expect(200);
    const v = await staff('VERIFIER');
    const res = await review(v.cookie, id, { decision: 'APPROVED' }).expect(200);
    expect(res.body.company.status).toBe('APPROVED');
    expect(res.body.company.approvedAt).toBeTruthy();

    const detail = await h.http().get(`/api/v1/admin/companies/${id}`).set('Cookie', v.cookie).expect(200);
    expect(detail.body.reviews[0].decision).toBe('APPROVED');
    expect(await db.auditEvent.count({ where: { companyId: id, action: 'company.review.approved', actorId: v.id } })).toBe(1);

    await patch(owner.cookie, id, { city: 'Batroun' }).expect(200); // still editable
    const rename = await patch(owner.cookie, id, { name: 'Renamed Co' }).expect(409);
    expect(rename.body.code).toBe('name_locked_after_approval');
  });

  it('changes-requested and rejection need a reason; the owner can fix and resubmit', async () => {
    const { owner, id } = await readyCompany();
    await submit(owner.cookie, id).expect(200);
    const v = await staff('VERIFIER');
    await review(v.cookie, id, { decision: 'CHANGES_REQUESTED' }).expect(400);
    await review(v.cookie, id, { decision: 'REJECTED', reason: 'short' }).expect(400);
    await review(v.cookie, id, { decision: 'CHANGES_REQUESTED', reason: 'Please add a clearer description.' }).expect(200);

    await patch(owner.cookie, id, { description: 'A much clearer and longer description of our hiking offer.' }).expect(200);
    const again = await submit(owner.cookie, id).expect(200);
    expect(again.body.company.status).toBe('PENDING_REVIEW');
  });

  it('rejection is final for self-service editing', async () => {
    const { owner, id } = await readyCompany();
    await submit(owner.cookie, id).expect(200);
    const v = await staff('ADMIN');
    await review(v.cookie, id, { decision: 'REJECTED', reason: 'Documents could not be verified.' }).expect(200);
    await patch(owner.cookie, id, { city: 'X' }).expect(409);
    await submit(owner.cookie, id).expect(409);
  });

  it('a company can only be decided once, even by concurrent reviewers', async () => {
    const { owner, id } = await readyCompany();
    await submit(owner.cookie, id).expect(200);
    const a = await staff('VERIFIER');
    const b = await staff('ADMIN');
    const rs = await Promise.all([
      review(a.cookie, id, { decision: 'APPROVED' }),
      review(b.cookie, id, { decision: 'REJECTED', reason: 'Conflicting concurrent decision.' }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.companyReview.count({ where: { companyId: id } })).toBe(1);
  });

  it('cannot review a company that is not pending', async () => {
    const { id } = await readyCompany(); // still DRAFT
    const v = await staff('VERIFIER');
    const res = await review(v.cookie, id, { decision: 'APPROVED' }).expect(409);
    expect(res.body.code).toBe('not_pending_review');
  });

  it('staff cannot decide on their own company (conflict of interest)', async () => {
    const v = await staff('VERIFIER');
    const id = await newCompany(v);
    await patch(v.cookie, id, COMPLETE).expect(200);
    await submit(v.cookie, id).expect(200);
    const res = await review(v.cookie, id, { decision: 'APPROVED' }).expect(403);
    expect(res.body.code).toBe('conflict_of_interest');
    expect((await db.company.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING_REVIEW');
  });

  it('decisions need a recent step-up', async () => {
    const { owner, id } = await readyCompany();
    await submit(owner.cookie, id).expect(200);
    const v = await staff('VERIFIER');
    await db.session.updateMany({ where: { userId: v.id }, data: { stepUpAt: null } });
    const res = await review(v.cookie, id, { decision: 'APPROVED' }).expect(403);
    expect(res.body.code).toBe('step_up_required');
  });

  it('review endpoints reject malformed ids as 404', async () => {
    const v = await staff('VERIFIER');
    await review(v.cookie, 'not-a-uuid', { decision: 'APPROVED' }).expect(404);
    await h.http().get('/api/v1/admin/companies/not-a-uuid').set('Cookie', v.cookie).expect(404);
    await h.http().get('/api/v1/admin/companies?status=BOGUS').set('Cookie', v.cookie).expect(400);
  });
});

void PASSWORD;
