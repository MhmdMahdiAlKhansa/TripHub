import { Global, Module, OnApplicationShutdown, Inject } from '@nestjs/common';
import { createPrismaClient, PrismaClient } from '@triphub/database';

export const PRISMA = Symbol('PRISMA');

@Global()
@Module({
  providers: [{ provide: PRISMA, useFactory: () => createPrismaClient() }],
  exports: [PRISMA],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}
  async onApplicationShutdown() {
    await this.db.$disconnect();
  }
}
