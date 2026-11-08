import { ConflictException, Inject, Injectable, NotFoundException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { DocumentKind, PrismaClient } from '@triphub/database';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { PRISMA } from '../database/database.module';
import { safeFileName, sniffType } from '../storage/file-sniff';
import { newStorageKey, STORAGE, type ObjectStorage } from '../storage/storage';

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_LIVE_DOCUMENTS = 10;
const UPLOADABLE_STATUSES = ['DRAFT', 'CHANGES_REQUESTED', 'APPROVED'];

/** Reads a request body with a hard size cap, aborting early instead of buffering an oversized upload. */
export async function readCapped(stream: Readable, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > max) {
      stream.destroy();
      throw new PayloadTooLargeException({ code: 'file_too_large', maxBytes: max });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export const documentView = (d: { id: string; kind: string; originalName: string; contentType: string; sizeBytes: number; scanStatus: string; createdAt: Date }) => ({
  id: d.id,
  kind: d.kind,
  name: d.originalName,
  contentType: d.contentType,
  sizeBytes: d.sizeBytes,
  // PENDING means no antivirus scan has happened; it is never presented as clean.
  scanStatus: d.scanStatus,
  createdAt: d.createdAt,
});

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async upload(companyId: string, actorId: string, input: { kind: DocumentKind; name: string; declaredType?: string; data: Buffer }) {
    if (input.data.length === 0) throw new UnsupportedMediaTypeException({ code: 'empty_file' });
    const real = sniffType(input.data);
    if (!real) throw new UnsupportedMediaTypeException({ code: 'unsupported_file_type', allowed: ['pdf', 'png', 'jpeg', 'webp'] });
    if (input.declaredType && input.declaredType !== real && input.declaredType !== 'application/octet-stream') {
      throw new UnsupportedMediaTypeException({ code: 'file_type_mismatch' });
    }
    const company = await this.db.company.findUniqueOrThrow({ where: { id: companyId }, select: { status: true } });
    if (!UPLOADABLE_STATUSES.includes(company.status)) throw new ConflictException({ code: 'documents_locked', status: company.status });
    if ((await this.db.companyDocument.count({ where: { companyId, deletedAt: null } })) >= MAX_LIVE_DOCUMENTS) {
      throw new ConflictException({ code: 'too_many_documents', max: MAX_LIVE_DOCUMENTS });
    }

    const key = newStorageKey('docs');
    await this.storage.put(key, input.data);
    try {
      const row = await this.db.companyDocument.create({
        data: {
          companyId,
          kind: input.kind,
          originalName: safeFileName(input.name),
          contentType: real,
          sizeBytes: input.data.length,
          sha256: createHash('sha256').update(input.data).digest('hex'),
          storageKey: key,
          uploadedBy: actorId,
        },
      });
      await this.db.auditEvent.create({
        data: { action: 'company.document_uploaded', actorId, companyId, entityType: 'company_document', entityId: row.id, meta: { kind: input.kind, bytes: input.data.length } },
      });
      return row;
    } catch (e) {
      await this.storage.remove(key); // no orphaned bytes if the row could not be saved
      throw e;
    }
  }

  list(companyId: string) {
    return this.db.companyDocument.findMany({ where: { companyId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  /** Marks the document deleted (the record stays for the audit trail) and removes the stored bytes. */
  async remove(companyId: string, actorId: string, id: string) {
    const d = await this.db.companyDocument.findFirst({ where: { id, companyId, deletedAt: null }, include: { company: { select: { status: true } } } });
    if (!d) throw new NotFoundException();
    if (!UPLOADABLE_STATUSES.includes(d.company.status)) throw new ConflictException({ code: 'documents_locked', status: d.company.status });
    await this.db.companyDocument.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.storage.remove(d.storageKey);
    await this.db.auditEvent.create({
      data: { action: 'company.document_deleted', actorId, companyId, entityType: 'company_document', entityId: id, meta: {} },
    });
  }

  async download(id: string, scope: { companyId?: string }, actorId: string) {
    const d = await this.db.companyDocument.findFirst({ where: { id, deletedAt: null, ...(scope.companyId ? { companyId: scope.companyId } : {}) } });
    if (!d) throw new NotFoundException();
    const data = await this.storage.get(d.storageKey);
    if (!data) throw new NotFoundException();
    await this.db.auditEvent.create({
      data: { action: 'company.document_downloaded', actorId, companyId: d.companyId, entityType: 'company_document', entityId: id, meta: { by: scope.companyId ? 'business' : 'platform' } },
    });
    return { doc: d, data };
  }
}
