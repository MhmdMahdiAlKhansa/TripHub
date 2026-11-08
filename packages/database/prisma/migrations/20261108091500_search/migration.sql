-- Search: Arabic-aware normalisation + trigram index. Must mirror normalizeSearch() in @triphub/shared.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE FUNCTION th_normalize(input text) RETURNS text AS $$
  SELECT btrim(regexp_replace(
    translate(
      lower(regexp_replace(coalesce(input, ''), '[\u064B-\u065F\u0670\u0640]', '', 'g')),
      'أإآٱىة٠١٢٣٤٥٦٧٨٩',
      'اااايه0123456789'),
    '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

ALTER TABLE "listing_translation"
  ADD COLUMN "searchText" text GENERATED ALWAYS AS (
    th_normalize(coalesce("title", '') || ' ' || coalesce("summary", '') || ' ' || coalesce("description", ''))
  ) STORED;

CREATE INDEX listing_translation_search_trgm ON "listing_translation" USING gin ("searchText" gin_trgm_ops);
