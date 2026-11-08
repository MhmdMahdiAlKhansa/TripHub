import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryService, ModulesContainer } from '@nestjs/core';
import { createPrismaClient, PrismaClient } from '@triphub/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, slug, type Harness, type TestUser } from '../testing/harness';
import { PERMISSION_KEY, TenantGuard } from './tenancy.guards';

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

async function company(owner: TestUser) {
  const res = await h
    .http()
    .post('/api/v1/companies')
    .set('Cookie', owner.cookie)
    .send({ name: 'Cedar Treks', slug: slug() })
    .expect(201);
  return res.body.company.id as string;
}

/** Invite `invitee` with `role` and accept, as the full real flow. */
async function addMember(companyId: string, owner: TestUser, invitee: TestUser, role: string) {
  await h
    .http()
    .post(`/api/v1/companies/${companyId}/invitations`)
    .set('Cookie', owner.cookie)
    .send({ email: invitee.email, role })
    .expect(202);
  await h
    .http()
    .post('/api/v1/invitations/accept')
    .set('Cookie', invitee.cookie)
    .send({ token: h.lastToken(invitee.email, 'company-invitation') })
    .expect(200);
}
const memberIdOf = async (companyId: string, userId: string) =>
  (await db.membership.findFirstOrThrow({ where: { companyId, userId } })).id;

describe('company creation', () => {
  it('requires login, creates the caller as OWNER, and rejects duplicate slugs', async () => {
    await h.http().post('/api/v1/companies').send({ name: 'X Co', slug: slug() }).expect(401);
    const u = await h.newUser();
    const s = slug();
    await h.http().post('/api/v1/companies').set('Cookie', u.cookie).send({ name: 'A Co', slug: s }).expect(201);
    await h.http().post('/api/v1/companies').set('Cookie', u.cookie).send({ name: 'B Co', slug: s }).expect(409);
    const mine = await h.http().get('/api/v1/companies').set('Cookie', u.cookie).expect(200);
    expect(mine.body.companies[0].role).toBe('OWNER');
    expect(mine.body.companies[0].status).toBe('DRAFT');
  });
  it('validates slug format', async () => {
    const u = await h.newUser();
    await h.http().post('/api/v1/companies').set('Cookie', u.cookie).send({ name: 'Ok', slug: 'Bad Slug!' }).expect(400);
  });
});

describe('cross-tenant isolation', () => {
  it('a non-member gets 404 (not 403) for every :companyId route, and unauthenticated gets 401', async () => {
    const ownerA = await h.newUser();
    const ownerB = await h.newUser();
    const companyA = await company(ownerA);
    await company(ownerB);
    const memberIdA = await memberIdOf(companyA, ownerA.id);

    const discovery = new DiscoveryService(h.app.get(ModulesContainer));
    const routes: { method: string; url: string; handler: Function; ctrl: Function }[] = [];
    for (const w of discovery.getControllers()) {
      const ctor = w.metatype as Function | null;
      if (!ctor) continue;
      const base = String(Reflect.getMetadata('path', ctor) ?? '');
      const version = Reflect.getMetadata('__version__', ctor);
      for (const key of Object.getOwnPropertyNames(ctor.prototype)) {
        const fn = ctor.prototype[key];
        if (typeof fn !== 'function' || key === 'constructor') continue;
        const mPath = Reflect.getMetadata('path', fn);
        const method = Reflect.getMetadata('method', fn);
        if (mPath === undefined || method === undefined) continue;
        const url = `/api/v${version}/${base}/${mPath}`.replace(/\/+/g, '/').replace(/\/$/, '');
        routes.push({ method: RequestMethod[method]!, url, handler: fn, ctrl: ctor });
      }
    }
    const tenantRoutes = routes.filter((r) => r.url.includes(':companyId'));
    // Currently 5 tenant routes; the floor guards against discovery silently finding nothing.
    expect(tenantRoutes.length).toBeGreaterThanOrEqual(5);

    for (const r of tenantRoutes) {
      const label = `${r.method} ${r.url}`;
      // Structural: deny-by-default metadata is present on every tenant route.
      expect(Reflect.getMetadata(PERMISSION_KEY, r.handler), `${label} lacks RequirePermission`).toBeTruthy();
      expect(Reflect.getMetadata('__guards__', r.handler) ?? [], `${label} lacks TenantGuard`).toContain(TenantGuard);

      const url = r.url.replace(':companyId', companyA).replace(':memberId', memberIdA);
      const send = (cookie?: string) => {
        let req = (h.http() as any)[r.method.toLowerCase()](url).send({ role: 'OWNER', email: 'x@example.test', name: 'x' });
        if (cookie) req = req.set('Cookie', cookie);
        return req;
      };
      expect((await send()).status, `${label} unauthenticated`).toBe(401);
      expect((await send(ownerB.cookie)).status, `${label} as other tenant`).toBe(404);
    }
    // Company A is untouched by all of the above.
    expect(await db.membership.count({ where: { companyId: companyA, status: 'ACTIVE' } })).toBe(1);
  });

  it('a malformed company id is 404, and another tenant id cannot be reached via own company path', async () => {
    const ownerA = await h.newUser();
    const ownerB = await h.newUser();
    const companyA = await company(ownerA);
    const companyB = await company(ownerB);
    await h.http().get('/api/v1/companies/not-a-uuid').set('Cookie', ownerA.cookie).expect(404);
    // B tries to change A's membership through B's own company path -> 404
    const memberA = await memberIdOf(companyA, ownerA.id);
    await h
      .http()
      .patch(`/api/v1/companies/${companyB}/members/${memberA}`)
      .set('Cookie', ownerB.cookie)
      .send({ role: 'FINANCE' })
      .expect(404);
    await h.http().delete(`/api/v1/companies/${companyB}/members/${memberA}`).set('Cookie', ownerB.cookie).expect(404);
    expect((await db.membership.findUniqueOrThrow({ where: { id: memberA } })).role).toBe('OWNER');
  });

  it('a user in two companies only sees each company through its own role', async () => {
    const a = await h.newUser();
    const b = await h.newUser();
    const ca = await company(a);
    const cb = await company(b);
    await addMember(cb, b, a, 'BOOKING_STAFF');
    const asOwner = await h.http().get(`/api/v1/companies/${ca}`).set('Cookie', a.cookie).expect(200);
    const asStaff = await h.http().get(`/api/v1/companies/${cb}`).set('Cookie', a.cookie).expect(200);
    expect(asOwner.body.role).toBe('OWNER');
    expect(asStaff.body.role).toBe('BOOKING_STAFF');
    await h.http().post(`/api/v1/companies/${cb}/invitations`).set('Cookie', a.cookie)
      .send({ email: 'z@example.test', role: 'MANAGER' }).expect(403);
  });
});

describe('RBAC and team management', () => {
  it('only the owner can invite or change roles; others get 403', async () => {
    const owner = await h.newUser();
    const mgr = await h.newUser();
    const c = await company(owner);
    await addMember(c, owner, mgr, 'MANAGER');
    await h.http().get(`/api/v1/companies/${c}/members`).set('Cookie', mgr.cookie).expect(200);
    await h.http().post(`/api/v1/companies/${c}/invitations`).set('Cookie', mgr.cookie)
      .send({ email: 'q@example.test', role: 'FINANCE' }).expect(403);
    const ownerMember = await memberIdOf(c, owner.id);
    await h.http().patch(`/api/v1/companies/${c}/members/${ownerMember}`).set('Cookie', mgr.cookie)
      .send({ role: 'MANAGER' }).expect(403);
  });

  it('removed members lose access immediately', async () => {
    const owner = await h.newUser();
    const staff = await h.newUser();
    const c = await company(owner);
    await addMember(c, owner, staff, 'BOOKING_STAFF');
    await h.http().get(`/api/v1/companies/${c}`).set('Cookie', staff.cookie).expect(200);
    const mid = await memberIdOf(c, staff.id);
    await h.http().delete(`/api/v1/companies/${c}/members/${mid}`).set('Cookie', owner.cookie).expect(204);
    await h.http().get(`/api/v1/companies/${c}`).set('Cookie', staff.cookie).expect(404);
  });

  it('role changes take effect on the very next request', async () => {
    const owner = await h.newUser();
    const m = await h.newUser();
    const c = await company(owner);
    await addMember(c, owner, m, 'MANAGER');
    await h.http().get(`/api/v1/companies/${c}/members`).set('Cookie', m.cookie).expect(200);
    await h.http().patch(`/api/v1/companies/${c}/members/${await memberIdOf(c, m.id)}`)
      .set('Cookie', owner.cookie).send({ role: 'FINANCE' }).expect(200);
    // FINANCE still has team.view; verify a permission it lost: none of the routes need booking yet,
    // so check the stored role and that team.manage is still denied.
    expect((await db.membership.findFirstOrThrow({ where: { companyId: c, userId: m.id } })).role).toBe('FINANCE');
    await h.http().post(`/api/v1/companies/${c}/invitations`).set('Cookie', m.cookie)
      .send({ email: 'r@example.test', role: 'FINANCE' }).expect(403);
  });

  it('the last owner cannot be removed or demoted (409), including by themselves', async () => {
    const owner = await h.newUser();
    const c = await company(owner);
    const mid = await memberIdOf(c, owner.id);
    await h.http().delete(`/api/v1/companies/${c}/members/${mid}`).set('Cookie', owner.cookie).expect(409);
    await h.http().patch(`/api/v1/companies/${c}/members/${mid}`).set('Cookie', owner.cookie)
      .send({ role: 'MANAGER' }).expect(409);
    expect((await db.membership.findUniqueOrThrow({ where: { id: mid } })).status).toBe('ACTIVE');
  });

  it('two owners removing each other at the same time leaves exactly one owner', async () => {
    const o1 = await h.newUser();
    const o2 = await h.newUser();
    const c = await company(o1);
    await addMember(c, o1, o2, 'OWNER');
    const m1 = await memberIdOf(c, o1.id);
    const m2 = await memberIdOf(c, o2.id);
    const [r1, r2] = await Promise.all([
      h.http().delete(`/api/v1/companies/${c}/members/${m2}`).set('Cookie', o1.cookie),
      h.http().delete(`/api/v1/companies/${c}/members/${m1}`).set('Cookie', o2.cookie),
    ]);
    // Exactly one wins. The loser is refused: 409 (database guard) or 404 (already lost access).
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(204);
    expect([404, 409]).toContain(statuses[1]);
    expect(await db.membership.count({ where: { companyId: c, role: 'OWNER', status: 'ACTIVE' } })).toBe(1);
  });

  it('database trigger alone prevents zero owners under a concurrent race (bypassing the API)', async () => {
    const o1 = await h.newUser();
    const o2 = await h.newUser();
    const c = await company(o1);
    await addMember(c, o1, o2, 'OWNER');
    const m1 = await memberIdOf(c, o1.id);
    const m2 = await memberIdOf(c, o2.id);
    const results = await Promise.allSettled([
      db.membership.update({ where: { id: m1 }, data: { status: 'REMOVED' } }),
      db.membership.update({ where: { id: m2 }, data: { status: 'REMOVED' } }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.membership.count({ where: { companyId: c, role: 'OWNER', status: 'ACTIVE' } })).toBe(1);
  });

  it('writes audit events with the company id', async () => {
    const owner = await h.newUser();
    const m = await h.newUser();
    const c = await company(owner);
    await addMember(c, owner, m, 'MANAGER');
    const actions = (await db.auditEvent.findMany({ where: { companyId: c } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['company.created', 'team.invited', 'team.invitation_accepted']));
  });
});

describe('invitations', () => {
  it('can only be accepted by the invited email, once, before expiry', async () => {
    const owner = await h.newUser();
    const invitee = await h.newUser();
    const stranger = await h.newUser();
    const c = await company(owner);
    await h.http().post(`/api/v1/companies/${c}/invitations`).set('Cookie', owner.cookie)
      .send({ email: invitee.email, role: 'FINANCE' }).expect(202);
    const token = h.lastToken(invitee.email, 'company-invitation');

    await h.http().post('/api/v1/invitations/accept').set('Cookie', stranger.cookie).send({ token }).expect(400);
    await h.http().post('/api/v1/invitations/accept').send({ token }).expect(401);
    const results = await Promise.all(
      [1, 2, 3].map(() => h.http().post('/api/v1/invitations/accept').set('Cookie', invitee.cookie).send({ token })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await db.membership.count({ where: { companyId: c, userId: invitee.id } })).toBe(1);
  });

  it('expired and re-issued (revoked) invitations are rejected', async () => {
    const owner = await h.newUser();
    const invitee = await h.newUser();
    const c = await company(owner);
    const send = () => h.http().post(`/api/v1/companies/${c}/invitations`).set('Cookie', owner.cookie)
      .send({ email: invitee.email, role: 'MANAGER' }).expect(202);
    await send();
    const first = h.lastToken(invitee.email, 'company-invitation');
    await send();
    await h.http().post('/api/v1/invitations/accept').set('Cookie', invitee.cookie).send({ token: first }).expect(400);

    const second = h.lastToken(invitee.email, 'company-invitation');
    await db.invitation.updateMany({ where: { companyId: c, acceptedAt: null, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await h.http().post('/api/v1/invitations/accept').set('Cookie', invitee.cookie).send({ token: second }).expect(400);
  });

  it('cannot invite someone who is already a member', async () => {
    const owner = await h.newUser();
    const m = await h.newUser();
    const c = await company(owner);
    await addMember(c, owner, m, 'MANAGER');
    await h.http().post(`/api/v1/companies/${c}/invitations`).set('Cookie', owner.cookie)
      .send({ email: m.email, role: 'MANAGER' }).expect(409);
  });
});
