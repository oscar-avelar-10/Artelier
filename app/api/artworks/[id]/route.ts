import { museumFields, normalizeArtwork, type MuseumArtwork } from '@/lib/artworks';
import { protectedMuseumJSON } from '@/lib/museum-service';
import { POLICY, PolicyError } from '@/lib/museum-policy';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,7}$/.test(id) || new URL(request.url).search) return Response.json({ error: 'Invalid artwork.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  return protectedMuseumJSON<{ data: MuseumArtwork }>(request, `https://openaccess-api.clevelandart.org/api/artworks/${id}?fields=${museumFields}`, POLICY.detailTtlMs, result => {
    if (!result.data?.id) throw new PolicyError('This artwork could not be found.', 404, 30);
    const art = normalizeArtwork(result.data);
    if (!art.is_public_domain || !art.image_url) throw new PolicyError('This artwork is not available in our open collection.', 404, 30);
    return { data: art, config: { iiif_url: '' } };
  });
}
