// Load tests against a RUNNING stack (API :4000, web :3000) started with RATE_LIMIT_DISABLED=1.
//   RATE_LIMIT_DISABLED=1 DEV_MAILBOX=1 pnpm --filter @triphub/api start   (never in production)
//   pnpm --filter @triphub/web start
//   pnpm --filter @triphub/loadtest load
// Numbers are from ONE developer machine running the API, web, Postgres and Redis together, so they are a
// regression baseline, not a capacity promise.
import autocannon from 'autocannon';

const API = process.env.LOAD_API ?? 'http://localhost:4000/api/v1';
const WEB = process.env.LOAD_WEB ?? 'http://localhost:3000';
const DURATION = Number(process.env.LOAD_SECONDS ?? 12);
const BOOKERS = Number(process.env.LOAD_BOOKERS ?? 150);
const SEATS = Number(process.env.LOAD_SEATS ?? 100);
const ORIGIN = { origin: 'http://localhost:3000' };
const json = { 'content-type': 'application/json', ...ORIGIN };

const results = [];
const ms = (n) => Math.round(n * 10) / 10;

async function run(name, url, connections = 40, extra = {}) {
  const r = await autocannon({ url, connections, duration: DURATION, ...extra });
  const ok = r['2xx'];
  const bad = r.non2xx + r.errors + r.timeouts;
  results.push({ name, connections, rps: Math.round(r.requests.average), p50: r.latency.p50, p97_5: r.latency.p97_5, p99: r.latency.p99, max: r.latency.max, ok, bad });
  console.log(`${name.padEnd(34)} c=${String(connections).padEnd(3)} ${String(Math.round(r.requests.average)).padStart(6)} req/s  p50 ${ms(r.latency.p50)}ms  p99 ${ms(r.latency.p99)}ms  ok ${ok}  bad ${bad}`);
  return r;
}

async function req(method, path, { body, cookie, headers } = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { ...json, ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
}

// ------------------------------------------------------------------ read paths
const list = await (await fetch(`${API}/public/listings?limit=1&q=DEMO`)).json();
const listingId = list.listings?.[0]?.id;
if (!listingId) throw new Error('Run `pnpm --filter @triphub/api seed` first (needs the DEMO listings).');

console.log(`\nRead paths (${DURATION}s each)`);
await run('API  GET /public/listings', `${API}/public/listings?limit=20`);
await run('API  GET /public/listings?q=DEMO', `${API}/public/listings?q=DEMO&limit=20`);
await run('API  GET /public/listings (filters)', `${API}/public/listings?region=north&guests=2&mode=bookable&limit=20`);
await run('API  GET /public/listings/:id', `${API}/public/listings/${listingId}`);
await run('API  GET availability', `${API}/public/listings/${listingId}/availability`);
await run('WEB  GET /en (home, SSR)', `${WEB}/en`, 20);
await run('WEB  GET /en/explore (SSR)', `${WEB}/en/explore`, 20);

// ------------------------------------------------------------------ write path: contention for a limited number of seats
console.log(`\nBooking contention: ${BOOKERS} customers race for ${SEATS} seats`);
const owner = await req('POST', '/auth/login', { body: { email: 'owner@demo.triphub.test', password: 'Demo-Password-123!' } });
if (owner.status !== 200) throw new Error(`owner login failed (${owner.status}); is RATE_LIMIT_DISABLED=1 set and the seed run?`);
const ownerCookie = owner.setCookie.split(';')[0];
const cid = (await req('GET', '/companies', { cookie: ownerCookie })).data.companies.find((c) => c.slug === 'demo-cedar-guides').id;
// Keep the demo trial under its 10-listing cap: archive old load-test listings first.
for (const l of (await req('GET', `/companies/${cid}/listings`, { cookie: ownerCookie })).data.listings ?? []) {
  if (l.status === 'PUBLISHED' && /^Load test /.test(l.translations?.en?.title ?? '')) await req('POST', `/companies/${cid}/listings/${l.id}/archive`, { cookie: ownerCookie });
}
const created = await req('POST', `/companies/${cid}/listings`, { cookie: ownerCookie, body: { category: 'hiking', bookingMode: 'FIXED_DATE', city: 'Bsharri', meetingPoint: 'Square', translations: { en: { title: `Load test ${Date.now()}`, description: 'A calm and carefully guided walk with plenty of time for photos and tea.' } } } });
const lid = created.data.listing.id;
await req('PUT', `/companies/${cid}/listings/${lid}/rates`, { cookie: ownerCookie, body: { rates: [{ kind: 'ADULT', amount: 0, currency: 'USD' }] } });
await req('POST', `/companies/${cid}/listings/${lid}/publish`, { cookie: ownerCookie });
const slot = await req('POST', `/companies/${cid}/listings/${lid}/slots`, { cookie: ownerCookie, body: { startsAt: new Date(Date.now() + 9 * 86_400_000).toISOString(), capacity: SEATS } });
const slotId = slot.data.slot.id;

// Create verified customers through the real flow (register, dev-mailbox link, verify, login).
const stamp = Date.now();
const t0 = Date.now();
const sessions = [];
const BATCH = 10;
for (let i = 0; i < BOOKERS; i += BATCH) {
  const batch = await Promise.all(
    Array.from({ length: Math.min(BATCH, BOOKERS - i) }, async (_, k) => {
      const email = `load-${stamp}-${i + k}@example.test`;
      const password = 'a-long-load-test-password-1';
      await req('POST', '/auth/register', { body: { email, password } });
      const mail = (await req('GET', '/dev/mailbox')).data.mails?.find((m) => m.to === email);
      if (!mail) throw new Error('dev mailbox empty: start the API with DEV_MAILBOX=1');
      await req('POST', '/auth/verify-email', { body: { token: new URL(mail.link).searchParams.get('token') } });
      const login = await req('POST', '/auth/login', { body: { email, password } });
      return login.setCookie.split(';')[0];
    }),
  );
  sessions.push(...batch);
}
console.log(`  created ${sessions.length} verified customers in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const start = Date.now();
const timings = [];
const outcomes = await Promise.all(
  sessions.map(async (cookie, i) => {
    const t = performance.now();
    const r = await req('POST', '/bookings', { cookie, headers: { 'idempotency-key': `load-${stamp}-${i}-abcdef` }, body: { listingId: lid, slotId, lines: [{ kind: 'ADULT', qty: 1 }] } });
    timings.push(performance.now() - t);
    return r.status;
  }),
);
const wall = Date.now() - start;
timings.sort((a, b) => a - b);
const q = (p) => timings[Math.min(timings.length - 1, Math.floor((p / 100) * timings.length))];
const won = outcomes.filter((s) => s === 201).length;
const refused = outcomes.filter((s) => s === 409).length;
const other = outcomes.length - won - refused;
const slotRow = (await req('GET', `/companies/${cid}/listings/${lid}/slots`, { cookie: ownerCookie })).data.slots.find((s) => s.id === slotId);
console.log(`  ${BOOKERS} simultaneous requests finished in ${wall} ms`);
console.log(`  confirmed ${won}, refused (full) ${refused}, other ${other}; slot reserved ${slotRow.reserved}/${slotRow.capacity}`);
console.log(`  latency p50 ${ms(q(50))}ms  p95 ${ms(q(95))}ms  p99 ${ms(q(99))}ms  max ${ms(timings[timings.length - 1])}ms`);
const exact = won === SEATS && slotRow.reserved === SEATS && other === 0;
console.log(exact ? '  INVARIANT OK: exactly the available seats were sold, never more.' : '  INVARIANT VIOLATED');

// ------------------------------------------------------------------ check-in under load
// A second date starting in 1 hour (inside the check-in window). Many tickets are scanned at once, then the same
// tickets are scanned again at once: every first scan must succeed and every repeat must be refused.
console.log('\nCheck-in: scan every ticket at once, then scan them all again');
const CHECKINS = Math.min(60, sessions.length);
const near = await req('POST', `/companies/${cid}/listings/${lid}/slots`, { cookie: ownerCookie, body: { startsAt: new Date(Date.now() + 3_600_000).toISOString(), capacity: CHECKINS } });
const nearId = near.data.slot.id;
const booked = await Promise.all(sessions.slice(0, CHECKINS).map(async (cookie, i) => {
  const b = await req('POST', '/bookings', { cookie, headers: { 'idempotency-key': `near-${stamp}-${i}-abcdef` }, body: { listingId: lid, slotId: nearId, lines: [{ kind: 'ADULT', qty: 1 }] } });
  if (b.status !== 201) return null;
  const t = await req('GET', `/bookings/${b.data.booking.id}/ticket`, { cookie });
  return t.data.ticket?.code ?? null;
}));
const codes = booked.filter(Boolean);
const scan = async (list) => {
  const t = performance.now();
  const out = await Promise.all(list.map((code) => req('POST', `/companies/${cid}/check-in`, { cookie: ownerCookie, body: { code } }).then((r) => r.status)));
  return { out, ms: Math.round(performance.now() - t) };
};
const first = await scan(codes);
const second = await scan(codes);
const firstOk = first.out.filter((s) => s === 200).length;
const secondRefused = second.out.filter((s) => s === 409).length;
console.log(`  ${codes.length} tickets: first scan ${firstOk} accepted in ${first.ms} ms; second scan ${secondRefused} refused in ${second.ms} ms`);
const checkInOk = codes.length === CHECKINS && firstOk === CHECKINS && secondRefused === CHECKINS;
console.log(checkInOk ? '  INVARIANT OK: each ticket was accepted exactly once.' : '  CHECK-IN INVARIANT VIOLATED');
results.push({ name: `Check-in ${CHECKINS} tickets`, firstOk, secondRefused, firstMs: first.ms, secondMs: second.ms, ok: checkInOk });
const allOk = exact && checkInOk;

await req('POST', `/companies/${cid}/listings/${lid}/archive`, { cookie: ownerCookie });

results.push({ name: `Booking race ${BOOKERS} for ${SEATS}`, wallMs: wall, won, refused, other, reserved: slotRow.reserved, p50: q(50), p95: q(95), p99: q(99), exact });
console.log('\nJSON', JSON.stringify(results));
process.exit(allOk ? 0 : 1);
