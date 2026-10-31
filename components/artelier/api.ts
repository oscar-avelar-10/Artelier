export function artworkSearchUrl(q:string,type:string,era:string,page:number) {
 return `/api/artworks?${new URLSearchParams({q,type,era,page:String(page)})}`;
}
export function artworkDetailUrl(id:number){return `/api/artworks/${id}`;}
