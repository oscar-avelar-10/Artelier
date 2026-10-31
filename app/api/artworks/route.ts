import { NextRequest } from 'next/server';
import { museumFields, normalizeArtwork, type MuseumArtwork } from '@/lib/artworks';
import { protectedMuseumJSON } from '@/lib/museum-service';
import { POLICY } from '@/lib/museum-policy';
const types: Record<string, string> = { paintings: 'Painting', prints: 'Print', drawings: 'Drawing', photography: 'Photograph', sculpture: 'Sculpture' };
const permitted = new Set(['q', 'type', 'era', 'page']);
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const q = (p.get('q') || '').trim().replace(/\s+/g, ' '), type = p.get('type') || 'all', era = p.get('era') || 'all', rawPage = p.get('page') || '1';
  if ([...p.keys()].some(key => !permitted.has(key) || p.getAll(key).length !== 1) || q.length > 100 || /[\u0000-\u001f]/.test(q) || (type !== 'all' && !Object.hasOwn(types, type)) || !['all', 'before-1800', '1800-1899', '1900-onwards'].includes(era) || !/^[1-9]\d{0,2}$/.test(rawPage) || Number(rawPage) > 100) {
    return Response.json({ error: 'Please use a valid search, category, period and page (1–100).' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const page = Number(rawPage);
  const url = new URL('https://openaccess-api.clevelandart.org/api/artworks/');
  url.searchParams.set('cc0', '1'); url.searchParams.set('has_image', '1'); url.searchParams.set('limit', '12'); url.searchParams.set('skip', String((page - 1) * 12)); url.searchParams.set('fields', museumFields);
  if (q) url.searchParams.set('q', q.toLowerCase());
  if (type !== 'all') url.searchParams.set('type', types[type]);
  if (era === 'before-1800') url.searchParams.set('created_before', '1800');
  if (era === '1800-1899') { url.searchParams.set('created_after', '1799'); url.searchParams.set('created_before', '1900'); }
  if (era === '1900-onwards') url.searchParams.set('created_after', '1899');
  if (!q && type === 'all' && era === 'all') url.searchParams.set('highlight', '1');
  return protectedMuseumJSON<{ data: MuseumArtwork[]; info: { total: number } }>(request, url.toString(), POLICY.searchTtlMs, result => {
    if (!Array.isArray(result.data) || !Number.isFinite(result.info?.total)) throw new Error('Invalid museum response');
    return { data: result.data.map(normalizeArtwork).filter(a => a.is_public_domain && a.image_url), pagination: { total: result.info.total, total_pages: Math.ceil(result.info.total / 12), current_page: page }, config: { iiif_url: '' } };
  });
}
