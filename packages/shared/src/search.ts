/**
 * Search normalisation. MUST stay identical to the SQL function `th_normalize` (see the search
 * migration): the database index and the query are normalised the same way, so Arabic spelling
 * variants find each other.
 *  - lower-case
 *  - remove Arabic diacritics (harakat), superscript alef and tatweel
 *  - alef variants (أ إ آ ٱ) -> ا, alef maqsura (ى) -> ي, ta marbuta (ة) -> ه
 *  - Arabic-Indic digits -> ASCII digits
 */
const FROM = 'أإآٱىة٠١٢٣٤٥٦٧٨٩';
const TO = 'اااايه0123456789';

export function normalizeSearch(input: string): string {
  let out = input.toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, '');
  let mapped = '';
  for (const ch of out) {
    const i = FROM.indexOf(ch);
    mapped += i === -1 ? ch : TO[i];
  }
  out = mapped;
  return out.replace(/\s+/g, ' ').trim();
}

/** Up to 6 distinct search terms, each at least 2 characters. */
export function searchTerms(input: string): string[] {
  return [...new Set(normalizeSearch(input).split(' ').filter((t) => t.length >= 2))].slice(0, 6);
}
