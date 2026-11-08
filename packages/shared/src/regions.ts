/**
 * Editorial regions used for exploring Lebanon. A listing belongs to a region when its city matches one
 * of the names below (case-insensitive, English or Arabic). This is a naming list, not geometry; a proper
 * region field on listings is a later improvement. Wording is a proposal pending owner review.
 */
export const REGIONS = [
  { slug: 'beirut', cities: ['beirut', 'بيروت'] },
  { slug: 'chouf', cities: ['chouf', 'shouf', 'deir el qamar', 'beiteddine', 'barouk', 'الشوف', 'دير القمر', 'بيت الدين'] },
  { slug: 'jbeil', cities: ['jbeil', 'byblos', 'amchit', 'جبيل', 'عمشيت'] },
  { slug: 'bekaa', cities: ['bekaa', 'baalbek', 'zahle', 'anjar', 'البقاع', 'بعلبك', 'زحلة', 'عنجر'] },
  { slug: 'akkar', cities: ['akkar', 'halba', 'عكار', 'حلبا'] },
  { slug: 'north', cities: ['bsharri', 'bcharre', 'tannourine', 'ehden', 'tripoli', 'batroun', 'بشري', 'تنورين', 'إهدن', 'طرابلس', 'البترون'] },
  { slug: 'south', cities: ['tyre', 'sour', 'saida', 'sidon', 'jezzine', 'nabatieh', 'صور', 'صيدا', 'جزين', 'النبطية'] },
] as const;
export type RegionSlug = (typeof REGIONS)[number]['slug'];
export const REGION_SLUGS = REGIONS.map((r) => r.slug) as unknown as readonly [RegionSlug, ...RegionSlug[]];
export const regionCities = (slug: RegionSlug): readonly string[] => REGIONS.find((r) => r.slug === slug)?.cities ?? [];
