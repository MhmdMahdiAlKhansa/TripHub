import { BadRequestException, Controller, Delete, Get, HttpCode, Inject, Param, Put, Query, Req, Res, UnsupportedMediaTypeException, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PlatformGuard, RequirePlatformPermission } from '../admin/admin.guards';
import { SessionGuard, type AuthedRequest } from '../auth/auth.guards';
import { RateLimit } from '../ratelimit/ratelimit';
import { PermissionGuard, RequirePermission, TenantGuard, UUID_RE, type TenantRequest } from '../tenancy/tenancy.guards';
import { documentView, DocumentsService, MAX_DOCUMENT_BYTES, readCapped } from './documents.service';

const UploadQuery = z.object({
  kind: z.enum(['BUSINESS_LICENSE', 'OWNER_ID', 'OTHER']),
  name: z.string().trim().min(1).max(200).default('document'),
});
const idOr404 = (id: string) => {
  if (!UUID_RE.test(id)) throw new NotFoundException();
  return id;
};

function send(res: Response, d: { doc: { originalName: string; contentType: string; scanStatus: string }; data: Buffer }) {
  res.setHeader('Content-Type', d.doc.contentType);
  // Always a download, never rendered inline, so an uploaded file cannot run in our origin.
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(d.doc.originalName)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Scan-Status', d.doc.scanStatus);
  res.send(d.data);
}

@ApiTags('company-documents')
@Controller({ path: 'companies/:companyId/documents', version: '1' })
export class CompanyDocumentsController {
  constructor(@Inject(DocumentsService) private readonly svc: DocumentsService) {}

  /** Raw-body upload (PDF, PNG, JPEG or WebP, up to 5 MB). The file type is decided from the bytes. */
  @Put()
  @RateLimit({ limit: 20, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('company.profile.edit')
  async upload(@Req() req: TenantRequest & Request, @Query() query: Record<string, unknown>) {
    const q = UploadQuery.safeParse(query);
    if (!q.success) throw new BadRequestException({ code: 'validation_error' });
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (contentType === 'application/json' || contentType.startsWith('multipart/')) {
      throw new UnsupportedMediaTypeException({ code: 'send_raw_file_body' });
    }
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_DOCUMENT_BYTES) throw new BadRequestException({ code: 'file_too_large', maxBytes: MAX_DOCUMENT_BYTES });
    const data = await readCapped(req, MAX_DOCUMENT_BYTES);
    const row = await this.svc.upload(req.membership!.companyId, req.user!.id, { kind: q.data.kind, name: q.data.name, declaredType: contentType || undefined, data });
    return { document: documentView(row) };
  }

  @Get()
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('company.profile.edit')
  async list(@Req() req: TenantRequest) {
    return { documents: (await this.svc.list(req.membership!.companyId)).map(documentView) };
  }

  @Get(':docId/download')
  @RateLimit({ limit: 30, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('company.profile.edit')
  async download(@Req() req: TenantRequest, @Param('docId') docId: string, @Res() res: Response) {
    send(res, await this.svc.download(idOr404(docId), { companyId: req.membership!.companyId }, req.user!.id));
  }

  @Delete(':docId')
  @HttpCode(204)
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('company.profile.edit')
  async remove(@Req() req: TenantRequest, @Param('docId') docId: string) {
    await this.svc.remove(req.membership!.companyId, req.user!.id, idOr404(docId));
  }
}

@ApiTags('admin-documents')
@Controller({ path: 'admin', version: '1' })
@UseGuards(SessionGuard, PlatformGuard)
export class AdminDocumentsController {
  constructor(@Inject(DocumentsService) private readonly svc: DocumentsService) {}

  @Get('companies/:id/documents')
  @RequirePlatformPermission('company.review.view')
  async list(@Param('id') id: string) {
    return { documents: (await this.svc.list(idOr404(id))).map(documentView) };
  }

  @Get('documents/:docId/download')
  @RateLimit({ limit: 60, windowSec: 60 })
  @RequirePlatformPermission('company.review.view')
  async download(@Param('docId') docId: string, @Req() req: AuthedRequest, @Res() res: Response) {
    send(res, await this.svc.download(idOr404(docId), {}, req.user!.id));
  }
}
