import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { safeFileName, sniffType } from '../storage/file-sniff';
import { createHarness, type Harness, type TestUser } from '../testing/harness';

let h: Harness;
let verifier: TestUser;
beforeAll(async () => {
  h = await createHarness();
  verifier = await h.staff('VERIFIER');
});
afterAll(async () => h.close());

const A = '/api/v1';
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 0x41)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]);

const put = (c: { owner: TestUser; companyId: string }, body: Buffer, opts: { type?: string; kind?: string; name?: string; user?: TestUser } = {}) =>
  h.http().put(`${A}/companies/${c.companyId}/documents`)
    .query({ kind: opts.kind ?? 'BUSINESS_LICENSE', name: opts.name ?? 'license.pdf' })
    .set('Cookie', (opts.user ?? c.owner).cookie)
    .set('Content-Type', opts.type ?? 'application/pdf')
    .send(body);

describe('file sniffing', () => {
  it('decides the type from the bytes and cleans names', () => {
    expect(sniffType(PDF)).toBe('application/pdf');
    expect(sniffType(PNG)).toBe('image/png');
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('image/webp');
    expect(sniffType(EXE)).toBeNull();
    expect(sniffType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffType(Buffer.alloc(0))).toBeNull();
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\evil\\a<b>.pdf')).toBe('a_b_.pdf');
    expect(safeFileName('...')).toBe('file');
    expect(safeFileName('رخصة العمل.pdf')).toBe('رخصة العمل.pdf');
  });
});

describe('verification documents', () => {
  it('accepts a real PDF/PNG, stores it privately, and reviewers can download it as an attachment', async () => {
    const c = await h.approvedCompany({ trial: false });
    const up = await put(c, PDF).expect(200);
    expect(up.body.document).toMatchObject({ kind: 'BUSINESS_LICENSE', contentType: 'application/pdf', scanStatus: 'PENDING', sizeBytes: PDF.length });
    await put(c, PNG, { type: 'image/png', kind: 'OWNER_ID', name: 'id.png' }).expect(200);

    const list = await h.http().get(`${A}/companies/${c.companyId}/documents`).set('Cookie', c.owner.cookie).expect(200);
    expect(list.body.documents).toHaveLength(2);

    const dl = await h.http().get(`${A}/admin/documents/${up.body.document.id}/download`).set('Cookie', verifier.cookie).expect(200);
    expect(dl.headers['content-disposition']).toContain('attachment');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['x-scan-status']).toBe('PENDING');
    expect(Buffer.compare(dl.body as Buffer, PDF)).toBe(0);
    const audit = await h.db.auditEvent.findFirst({ where: { action: 'company.document_downloaded', entityId: up.body.document.id } });
    expect(audit).toBeTruthy();
    const admList = await h.http().get(`${A}/admin/companies/${c.companyId}/documents`).set('Cookie', verifier.cookie).expect(200);
    expect(admList.body.documents).toHaveLength(2);
  });

  it('rejects disguised, empty, oversized and mislabeled files', async () => {
    const c = await h.approvedCompany({ trial: false });
    await put(c, EXE).expect(415);
    await put(c, Buffer.from('<html><script>alert(1)</script></html>'), { type: 'text/html', name: 'a.html' }).expect(415);
    await put(c, PDF, { type: 'image/png' }).expect(415); // says PNG, is a PDF
    await put(c, Buffer.alloc(0)).expect(415);
    // Oversized: the server refuses early, so the client sees either the 4xx or a closed connection.
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(5 * 1024 * 1024)]);
    const outcome = await put(c, big).then((r) => r.status, () => 'reset');
    expect([400, 413, 'reset']).toContain(outcome);
    await h.http().put(`${A}/companies/${c.companyId}/documents`).query({ kind: 'BUSINESS_LICENSE' }).set('Cookie', c.owner.cookie)
      .set('Content-Type', 'application/json').send({ file: 'x' }).expect(415);
    await put(c, PDF, { kind: 'SECRET' }).expect(400);
    expect((await h.http().get(`${A}/companies/${c.companyId}/documents`).set('Cookie', c.owner.cookie)).body.documents).toHaveLength(0);
  });

  it('is private to the business and platform reviewers, and gated by role and status', async () => {
    const c = await h.approvedCompany({ trial: false });
    const other = await h.approvedCompany({ trial: false });
    const up = (await put(c, PDF).expect(200)).body.document;

    await put(c, PDF, { user: other.owner }).expect(404); // another tenant
    await h.http().get(`${A}/companies/${other.companyId}/documents/${up.id}/download`).set('Cookie', other.owner.cookie).expect(404);
    await h.http().get(`${A}/companies/${c.companyId}/documents/${up.id}/download`).set('Cookie', other.owner.cookie).expect(404);
    const stranger = await h.newUser();
    await h.http().get(`${A}/admin/documents/${up.id}/download`).set('Cookie', stranger.cookie).expect(404);
    await h.http().get(`${A}/admin/documents/${up.id}/download`).expect(401);

    const staffUser = await h.newUser();
    await h.http().post(`${A}/companies/${c.companyId}/invitations`).set('Cookie', c.owner.cookie).send({ email: staffUser.email, role: 'BOOKING_STAFF' }).expect(202);
    await h.http().post(`${A}/invitations/accept`).set('Cookie', staffUser.cookie).send({ token: h.lastToken(staffUser.email, 'company-invitation') }).expect(200);
    await put(c, PDF, { user: staffUser }).expect(403);
    await h.http().get(`${A}/companies/${c.companyId}/documents`).set('Cookie', staffUser.cookie).expect(403);

    await h.db.company.update({ where: { id: c.companyId }, data: { status: 'PENDING_REVIEW' } });
    const locked = await put(c, PDF).expect(409);
    expect(locked.body.code).toBe('documents_locked');
  });

  it('delete keeps the audit record but removes the file and hides it', async () => {
    const c = await h.approvedCompany({ trial: false });
    const up = (await put(c, PDF).expect(200)).body.document;
    await h.http().delete(`${A}/companies/${c.companyId}/documents/${up.id}`).set('Cookie', c.owner.cookie).expect(204);
    await h.http().get(`${A}/companies/${c.companyId}/documents/${up.id}/download`).set('Cookie', c.owner.cookie).expect(404);
    expect((await h.http().get(`${A}/companies/${c.companyId}/documents`).set('Cookie', c.owner.cookie)).body.documents).toHaveLength(0);
    const row = await h.db.companyDocument.findUniqueOrThrow({ where: { id: up.id } });
    expect(row.deletedAt).not.toBeNull();
    await expect(h.db.companyDocument.delete({ where: { id: up.id } })).rejects.toThrow();
  });

  it('caps the number of documents', async () => {
    const c = await h.approvedCompany({ trial: false });
    for (let i = 0; i < 10; i++) await put(c, Buffer.concat([PDF, Buffer.from(String(i))])).expect(200);
    const r = await put(c, PDF).expect(409);
    expect(r.body.code).toBe('too_many_documents');
  });
});
