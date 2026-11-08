/**
 * Map configuration. A production map needs a tile provider you have a licence for: set
 * NEXT_PUBLIC_MAP_STYLE_URL (a MapLibre style JSON URL) and NEXT_PUBLIC_MAP_ORIGIN (its tile origin, for the
 * content-security policy). Without them the map is simply not shown in production. For local development
 * only, a raster OpenStreetMap style is used (their public tile servers must not be used for real traffic).
 */
export interface MapConfig {
  style: string | object;
  origins: string[];
}

const DEV_OSM_STYLE = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export function mapConfig(): MapConfig | null {
  const url = process.env.NEXT_PUBLIC_MAP_STYLE_URL;
  if (url) return { style: url, origins: (process.env.NEXT_PUBLIC_MAP_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean) };
  if (process.env.NODE_ENV !== 'production') return { style: DEV_OSM_STYLE, origins: ['https://tile.openstreetmap.org'] };
  return null;
}
