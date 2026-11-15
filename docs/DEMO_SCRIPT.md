# Demo script (3 minutes) and 60-second backup

Written for the stage at BDD. One core flow, live, no fake screens. Everything below exists in the product today;
anything marked [PILOT] needs the real pilot's numbers before it is said out loud.

## Before going on stage (checklist)
- Public URL open in two browser windows, signed in already: window A = the operator (owner desk), window B = a traveller.
- A trip published for a date 4 days out with **2 seats left** and 1 person on the waitlist (the seed does this).
- Phone on the podium signed in as door staff (the "Door desk"), for the check-in moment.
- Backup video on the laptop desktop, full screen ready.
- Internet fails? Switch to the backup video at once; do not try to fix anything on stage.

## 0:00–0:30 The problem
"This is [PILOT name], a hiking organiser in [PILOT city]. Every weekend trip starts the same way: an Instagram post, then
forty direct messages. Seats are counted in a notes app, deposits are chased one by one over Whish and OMT, and the
participant list is a pile of screenshots. On the last trip it took [PILOT hours] hours and two people still turned up
without paying."

## 0:30–2:15 The live flow
1. **Window A, owner desk.** "Here is the same trip on TripHub: date, 16 seats, $35, pickup points Hamra and Jounieh,
   a 50% deposit." (Show the listing; don't create one live.)
2. **Window B, traveller.** Open the trip, pick Saturday, 1 adult, pickup Hamra, add an emergency contact, Book.
   → "Your seat is held. Pay the organiser a deposit of $17.50 by Whish, OMT or cash."
3. **Window A.** The booking appears in "Bookings and check-in" as *Held*, with the participant's phone, pickup and
   emergency contact. "She sends the Whish transfer; I record it." Record deposit → WHISH → 17.50 → the row flips to
   *Confirmed*, and the traveller's page updates. "No seat is confirmed until money has moved. If the deposit never
   comes, the hold lapses and the seat goes to the waitlist automatically."
4. **Capacity.** "The last seat is gone. Watch what happens to the next person." Window B (second account, or the same
   account on another trip date): Book → *This date is full* → Join waitlist. Show the queue position.
5. **Door.** On the phone, Door desk: paste the ticket code → *Checked in, 1 seat*. Paste it again → *Already checked
   in*. "One ticket, one entry, even if two staff scan at once."
6. **Export.** Owner desk → "Download participants (CSV)": name, phone, pickup, emergency contact, deposit received.
   "That pile of screenshots is now one file."

## 2:15–2:45 One architecture slide
"Next.js front end, a NestJS API and a background worker, one Postgres database. The part that matters: capacity is
enforced inside the database with row locks, so 150 people booking 100 seats at the same second sell exactly 100 — we
load-tested it. Deposits are append-only records; the ledger cannot be edited. The worker sends the reminder the night
before and recycles unpaid seats to the waitlist." (If AI is shipped by then: one sentence on where the model sits,
what checks its output, and the fallback. If not: do not mention AI.)

## 2:45–3:00 The outcome and what's next
"[PILOT]'s last trip: [X] hours of chasing, [Y] unpaid seats. The next one on TripHub: [X'] hours, [Y'] unpaid." Then:
"Next: Whish deposits confirmed by webhook, so the organiser does not even have to record them."

## 60-second backup video (record on a quiet machine, 1080p, no narration needed, captions on screen)
0:00 traveller books and sees the deposit instruction · 0:15 owner records the deposit, row turns Confirmed ·
0:30 next traveller hits "full", joins waitlist · 0:40 door check-in twice (second refused) · 0:50 CSV export opens.

## What can go wrong, and the answer
- A login prompt appears: sessions last 14 days; sign in again the morning of the demo, never on stage.
- Gmail delays the email: the demo never depends on email; everything is visible in-app.
- The trip date passed: re-run the seed (`pnpm --filter @triphub/api seed`); it moves dates forward.
