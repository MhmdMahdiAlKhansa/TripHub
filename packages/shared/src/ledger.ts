/**
 * Splits a verified payment into the platform commission and the amount owed to the business.
 * Basis points, half-up rounding on the commission; the business gets the exact remainder, so the
 * two parts always add back to the total with no cent lost or created.
 */
export function splitPayment(totalMinor: bigint, commissionBps: number): { commissionMinor: bigint; payableMinor: bigint } {
  if (totalMinor < 0n) throw new RangeError('total must be non-negative');
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 10_000) {
    throw new RangeError('commissionBps must be an integer between 0 and 10000');
  }
  const commissionMinor = (totalMinor * BigInt(commissionBps) + 5000n) / 10_000n;
  return { commissionMinor, payableMinor: totalMinor - commissionMinor };
}

export interface PostingLine {
  /** Logical account, resolved to a ledger account row by the service. */
  account: 'PLATFORM_CASH' | 'COMPANY_PAYABLE' | 'PLATFORM_COMMISSION' | 'REFUND_PAYABLE';
  /** Signed: debit positive, credit negative. */
  amountMinor: bigint;
}

/** Postings for a payment that was verified and allocated to a booking. */
export function allocatedPaymentPostings(totalMinor: bigint, commissionBps: number): PostingLine[] {
  const { commissionMinor, payableMinor } = splitPayment(totalMinor, commissionBps);
  const lines: PostingLine[] = [{ account: 'PLATFORM_CASH', amountMinor: totalMinor }];
  if (payableMinor > 0n) lines.push({ account: 'COMPANY_PAYABLE', amountMinor: -payableMinor });
  if (commissionMinor > 0n) lines.push({ account: 'PLATFORM_COMMISSION', amountMinor: -commissionMinor });
  return lines;
}

/** Money verified as received but not attributable to a live booking: owed back to the customer. */
export function unallocatedPaymentPostings(totalMinor: bigint): PostingLine[] {
  return [
    { account: 'PLATFORM_CASH', amountMinor: totalMinor },
    { account: 'REFUND_PAYABLE', amountMinor: -totalMinor },
  ];
}

/**
 * Approving a refund of an allocated payment reverses the original split (business payable and
 * commission, using the same commission rate that was posted) into REFUND_PAYABLE.
 * Unallocated payments already sit in REFUND_PAYABLE, so approval posts nothing for them.
 */
export function refundApprovalPostings(totalMinor: bigint, commissionBps: number): PostingLine[] {
  const { commissionMinor, payableMinor } = splitPayment(totalMinor, commissionBps);
  const lines: PostingLine[] = [];
  if (payableMinor > 0n) lines.push({ account: 'COMPANY_PAYABLE', amountMinor: payableMinor });
  if (commissionMinor > 0n) lines.push({ account: 'PLATFORM_COMMISSION', amountMinor: commissionMinor });
  lines.push({ account: 'REFUND_PAYABLE', amountMinor: -totalMinor });
  return lines;
}

/** The money actually leaves: the refund liability is settled against cash. */
export function refundPaidPostings(totalMinor: bigint): PostingLine[] {
  return [
    { account: 'REFUND_PAYABLE', amountMinor: totalMinor },
    { account: 'PLATFORM_CASH', amountMinor: -totalMinor },
  ];
}

/** Money leaves the platform to the business: its payable is settled against cash. */
export function payoutPaidPostings(amountMinor: bigint): PostingLine[] {
  return [
    { account: 'COMPANY_PAYABLE', amountMinor },
    { account: 'PLATFORM_CASH', amountMinor: -amountMinor },
  ];
}

/** Hours after a trip starts before its earnings become payable (initial assumption). */
export const PAYOUT_HOLD_HOURS = 48;

export const sumLines = (lines: readonly PostingLine[]): bigint => lines.reduce((s, l) => s + l.amountMinor, 0n);
