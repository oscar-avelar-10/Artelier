import { NextResponse } from 'next/server';
import { museumFields, normalizeArtwork, type MuseumArtwork } from '@/lib/artworks';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 if(!/^\d{1,8}$/.test(id))return NextResponse.json({error:'Invalid artwork.'},{status:400});
 try{const res=await fetch(`https://openaccess-api.clevelandart.org/api/artworks/${id}?fields=${museumFields}`,{signal:AbortSignal.timeout(20000)});
 if(!res.ok)return NextResponse.json({error:'This artwork could not be loaded.'},{status:res.status===404?404:502});
 const result=await res.json() as {data:MuseumArtwork};const art=normalizeArtwork(result.data);
 if(!art.is_public_domain||!art.image_url)return NextResponse.json({error:'This artwork is not available in our open collection.'},{status:404});
 return NextResponse.json({data:art,config:{iiif_url:''}},{headers:{'Cache-Control':'public, s-maxage=3600'}});
 }catch{return NextResponse.json({error:'We couldn’t load this artwork. Please try again.'},{status:502});}
}
