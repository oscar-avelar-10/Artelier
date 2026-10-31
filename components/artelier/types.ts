export type Artwork = { id: number; title: string; artist_title: string | null; date_display: string; date_start: number; image_id: string; image_url?: string; large_image_url?:string; museum_url?:string; artwork_type_title: string; medium_display?: string; dimensions?: string; credit_line?: string; description?: string | null; place_of_origin?: string; thumbnail?: {alt_text?: string} | null; is_public_domain: boolean };
export type ArtworkPage = { data: Artwork[]; pagination: { total: number; total_pages: number; current_page: number }; config: {iiif_url: string} };
export const IMAGE_BASE = 'https://www.artic.edu/iiif/2';
export function imageUrl(art: Artwork, width=843, base=IMAGE_BASE) { return art.image_url || `${base}/${art.image_id}/full/${width},/0/default.jpg`; }
