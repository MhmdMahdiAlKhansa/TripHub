import { Global, Module } from '@nestjs/common';

/**
 * Capability switches for features that depend on parts not built (or not legally cleared) yet.
 * Defaults are OFF and are changed in code only when the feature is implemented AND verified -
 * never from an environment variable. Tests may override them through dependency injection.
 */
export interface Features {
  /**
   * Real money cannot move until manual payment verification and the ledger exist (slice 3.6/3.7).
   * While false: only free bookings are accepted and priced bookable listings cannot be published.
   */
  payments: boolean;
  /** Request-to-book (manual approval) needs the approval workflow (not built). */
  requestToBook: boolean;
}

export const FEATURES = Symbol('FEATURES');
export const DEFAULT_FEATURES: Features = { payments: false, requestToBook: false };

@Global()
@Module({
  providers: [{ provide: FEATURES, useValue: DEFAULT_FEATURES }],
  exports: [FEATURES],
})
export class FeaturesModule {}
