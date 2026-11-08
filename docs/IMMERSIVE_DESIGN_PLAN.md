# TripHub immersive frontend: plan for approval

Status: PROPOSAL. Nothing in this plan is implemented yet. I am waiting for your approval (see "Decisions I need").
Scope: the customer-facing discovery site gets the cinematic treatment. The business and staff dashboards stay
calm, dense and fast. Everything binds to the real API; nothing is invented.

## 1. Page structure (customer site)

| Route | Purpose | Key sections (top to bottom) |
|---|---|---|
| `/[locale]` Home | Cinematic entry | Hero (full viewport, image/video, headline, search bar, category chips, "Watch Lebanon in 60s") - Featured experiences (real published listings only) - Explore by region (cards) - Experiences by mood/season - Map teaser - How it works (verified businesses, honest booking states) - For businesses CTA - Footer |
| `/[locale]/explore` | Search + results | Sticky search/filter bar (where, dates, guests, category, price, cancellation policy) - results grid/list toggle - map panel (desktop split, mobile sheet) |
| `/[locale]/regions/[slug]` | Destination page | Region hero, short editorial intro, map, listings in the region |
| `/[locale]/listings/[id]` | Experience detail | Gallery hero (lightbox) - title/verified badge/rating (real reviews only) - highlights - description - meeting-point map - dates and availability - sticky booking card (price, date, guests, Book / Request / Join waiting list) - cancellation policy - reviews - nearby experiences |
| `/[locale]/login`, `register`, etc. | Account | Quiet, focused forms on a still image background |
| `/[locale]/profile`, `saved`, bookings | Customer area | Calm layout (not cinematic) |
| `/[locale]/business/*`, `/admin` | Operations | Existing dashboard style, refined with the new tokens only |

## 2. Component hierarchy

```
AppShell (header, locale/theme switch, bottom nav on phones)
  Hero
    MediaBackdrop (video -> poster fallback -> gradient)
    HeroHeadline, SearchBar (Where / Dates / Guests / Search)
    CategoryChips
  Reveal (scroll-in wrapper, one primitive used everywhere)
  Parallax (restrained, transform-only layer)
  RegionRail (snap-scroll carousel) > RegionCard
  ExperienceCard (editorial: image, category, title, city, "from" price, verified badge)
  Gallery (hero + thumbs) > Lightbox (focus-trapped)
  BookingCard (sticky; reuses the tested BookingWidget logic and API calls)
  MapView (MapLibre wrapper) > ListingMarker > MapPopupCard
  ReviewList, PolicyPanel, Breadcrumbs, SectionHeading
Dashboards: DataTable, StatTile, FormField, Toast (no scroll animation)
```
All built on one token file (below); components stay in `packages/ui` and `apps/web/src/components`.

## 3. Design tokens

| Token | Value |
|---|---|
| Forest Green (brand) | #285C50 |
| Sage (accent) | #8BAA96 |
| Warm Off-White (background) | #F7F8F3 |
| Mist Green (surface) | #E6ECE5 |
| Deep Pine (text / dark surface) | #263C36 |
| Fonts | DM Sans (English), Noto Sans Arabic (Arabic), self-hosted via @fontsource, no external requests |
| Radius / spacing | 16-28 px radii, 8 px grid, generous section padding |

Contrast: I will measure every text/background pair (WCAG AA 4.5:1, large text 3:1). Sage on Off-White will fail for
body text, so Sage is limited to decorative fills, borders and large display text; Deep Pine / Forest Green carry text.
Text over photography always sits on a scrim that I verify with axe and by sampling the rendered pixels.
Dark mode keeps working through the same tokens (Deep Pine becomes the page background).

## 4. Interaction and animation plan

- Hero: slow image crossfade or muted looping video behind a scrim; headline reveals once on load; search bar is always visible.
- Scroll reveals: `Reveal` fades and rises 16 px once per element via IntersectionObserver (no scroll listeners).
- Parallax: hero background and two decorative layers only, `transform: translate3d`, max about 40 px travel, disabled on touch and for reduced motion.
- Region rail: scroll-snap, arrow buttons, keyboard accessible.
- Cards: image zoom 1.04 and shadow on hover/focus-visible; heart button toggles with a short scale pulse.
- Gallery: crossfade between images, lightbox with focus trap and Escape.
- Map: markers fade in, popup card on select, list and map highlight each other.
- Rules: only `transform` and `opacity` are animated; total motion budget kept small; `prefers-reduced-motion` turns every animation into an instant state change and stops video autoplay; no content is ever hidden from crawlers or assistive tech by an animation (content is in the HTML, reveals only change its visual state); pause control for any video longer than 5 seconds.

## 5. Responsive behaviour

| Breakpoint | Behaviour |
|---|---|
| Phone (< 640) | Hero 100svh with stacked search (tap opens a full-screen sheet), bottom nav stays, rail swipes, booking card becomes a sticky bottom bar that opens a sheet, map is a toggled sheet |
| Tablet (640-1024) | Two-column grids, search bar inline, map toggled |
| Desktop (> 1024) | Full hero, 3-4 column grids, explore with split list/map, sticky booking card |
| RTL | Logical properties everywhere (`ms-`, `ps-`, `start-`), mirrored carousels and icons, Arabic hero typography tuned separately, tested with Playwright in both locales |

## 6. Data rules (no invention)

- Home "featured" = listings that are really published and, once I add the field, flagged by staff; if none exist the section shows an honest empty state, never sample cards.
- Prices: the cheapest real rate, formatted from integer minor units. Ratings and review counts: only from verified reviews; absent when zero.
- Availability: real slots and remaining seats. The booking card reuses the existing quote, idempotency, waitlist and request-to-book rules.
- Regions: a small editorial region list (Beirut, Mount Lebanon/Chouf, Jbeil, Bekaa, Akkar, North, South...) with my own short factual descriptions for you to review; region pages list real listings by city/region.
- Reference-image content such as "4.8 rating", "$25", "Tannourine Cedars Hike" is design illustration only and will not appear in the product.

## 7. Assets required (from you)

1. Licensed, high-resolution photography of Lebanon (hero landscapes, cedars, Qadisha, Jeita, Byblos/Jbeil, Baalbek, coast, food, people). I cannot source or fabricate these, and AI-generated "Lebanon" imagery would be inauthentic. Until you supply them I would ship tasteful gradient/pattern fallbacks, not fake photos.
2. Optional: a 15-30 s hero video (MP4 + WebM, under 4 MB, with a poster image) and rights to use it.
3. Region images (6-8) and an editorial text review in English and Arabic.
4. The logo you already gave me is used as is; a transparent-background version would look better on photos.
5. Confirmation of the "Watch Lebanon in 60s" video, or I drop that button.
Image pipeline I will add: responsive `srcset` (AVIF/WebP), blur-up placeholders, width/height to prevent layout shift, `loading=lazy` below the fold, `fetchpriority=high` on the hero. The upload API currently stores originals only; resizing needs an image-processing library (sharp) which I will add with your approval.

## 8. Technical notes

- Stack: existing Next.js 16, React 19, Tailwind 4, TypeScript. Animation via CSS plus a tiny IntersectionObserver hook (no heavy animation library) to protect performance. Maps: MapLibre GL with an OSM-based tile source (needs a tile provider choice, see below).
- Performance targets I will measure and report honestly: LCP under 2.5 s on a throttled mid phone profile, CLS under 0.1, JS for the home route under a set budget; Lighthouse and axe in the browser test suite.
- SEO: server-rendered pages, real `<h1>`, structured data (schema.org) for listings only from real data, hreflang already present, sitemap and robots, Open Graph images from real listing photos.
- The dashboards keep their current static, dense layout.

## 9. Decisions I need

1. Approve this structure and animation level (or tell me what to dial up/down).
2. Provide, or authorise a plan for, the photography and optional video (section 7).
3. Map tiles: free OSM tiles are not meant for production traffic; choose a provider (e.g. MapTiler/Stadia/self-hosted) and supply a key.
4. Allow adding the `sharp` dependency for image resizing.
5. Region list and wording: approve my proposed list, or send yours.

## 10. Proposed delivery order after approval

1. Tokens, fonts, motion primitives, reduced-motion handling, contrast tests.
2. Hero + search + category chips + region rail + featured experiences (real data).
3. Explore (filters, results, map split).
4. Experience detail (gallery, sticky booking card, map, reviews).
5. Performance and accessibility pass, browser tests in both locales and on phone.
