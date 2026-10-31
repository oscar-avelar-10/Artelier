import { NextRequest, NextResponse } from 'next/server';
import { museumFields, normalizeArtwork, type MuseumArtwork } from '@/lib/artworks';
const types:Record<string,string>={paintings:'Painting',prints:'Print',drawings:'Drawing',photography:'Photograph',sculpture:'Sculpture'};
export async function GET(request:NextRequest){
 const p=request.nextUrl.searchParams;
 const q=(p.get('q')||'').trim().slice(0,160),type=p.get('type')||'all',era=p.get('era')||'all';
 const page=Math.min(100,Math.max(1,parseInt(p.get('page')||'1')||1));
 const url=new URL('https://openaccess-api.clevelandart.org/api/artworks/');
 url.searchParams.set('cc0','1');url.searchParams.set('has_image','1');url.searchParams.set('limit','12');url.searchParams.set('skip',String((page-1)*12));url.searchParams.set('fields',museumFields);
 if(q)url.searchParams.set('q',q);
 if(types[type])url.searchParams.set('type',types[type]);
 if(era==='before-1800')url.searchParams.set('created_before','1800');
 if(era==='1800-1899'){url.searchParams.set('created_after','1799');url.searchParams.set('created_before','1900');}
 if(era==='1900-onwards')url.searchParams.set('created_after','1899');
 if(!q&&type==='all'&&era==='all')url.searchParams.set('highlight','1');
 try{const res=await fetch(url.toString(),{signal:AbortSignal.timeout(20000)});
 if(!res.ok)return NextResponse.json({error:res.status===429?'The museum is busy. Please wait a moment and try again.':'We couldn’t load the museum’s collection. Please try again.'},{status:res.status===429?429:502});
 const result=await res.json() as {data:MuseumArtwork[];info:{total:number}};
 const data=result.data.map(normalizeArtwork).filter(a=>a.is_public_domain&&a.image_url);
 return NextResponse.json({data,pagination:{total:result.info.total,total_pages:Math.ceil(result.info.total/12),current_page:page},config:{iiif_url:''}},{headers:{'Cache-Control':'public, s-maxage=300, stale-while-revalidate=600'}});
 }catch{return NextResponse.json({error:'The museum took too long to respond. Please try again.'},{status:502});}
}
