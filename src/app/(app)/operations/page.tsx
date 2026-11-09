export const metadata = { title: 'Operations · Trezia' };

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import OperationsTabs, { type OperationsTab } from '@/components/operations/OperationsTabs';
import { AssetsContent, DocumentsContent, VendorsContent } from '@/components/operations/OperationsContent';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { hasCapability, roleHome } from '@/lib/auth/roles';
import { societyPath } from '@/lib/society-path';
import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { requireAuth } from '@/lib/supabase/require-auth';
import type { AssetItem, ContractItem, DocumentItem, ExpenseOption, ServiceItem, VendorItem } from '@/components/operations/types';

const PAGE_SIZE = 100;

type SearchParams = { tab?: string; q?: string; category?: string; status?: string; page?: string };
type Search = Promise<SearchParams>;

// Thin shell — only `await searchParams` (no network) runs before the Suspense
// boundary, so a tab/filter change re-shows the skeleton immediately instead of
// leaving stale rows on screen while auth + data re-fetch (mirrors /payments).
export default async function OperationsPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  return (
    <Suspense key={JSON.stringify(params)} fallback={<ListSkeleton />}>
      <OperationsSection params={params} />
    </Suspense>
  );
}

async function OperationsSection({ params }: { params: SearchParams }) {
  const auth=await requireAuth(); if(auth.unauthorized)redirect('/login');
  const resident=auth.role==='resident';
  if(!(resident ? hasCapability(auth.role,'published_documents_read') : hasCapability(auth.role,'operations_read')))redirect(societyPath(auth.societySlug,roleHome(auth.role)));
  const requested=params.tab; const tab:OperationsTab=requested==='vendors'||requested==='assets'?requested:'documents';
  // Reject the tab before any operator table is queried. The redirect also gives
  // Residents a stable, bookmarkable Documents URL instead of a blank forbidden state.
  if(resident&&tab!=='documents')redirect(societyPath(auth.societySlug,'/operations?tab=documents'));

  const page=Math.max(1,Number.parseInt(params.page??'1',10)||1); const from=(page-1)*PAGE_SIZE; const to=page*PAGE_SIZE-1;
  const supabase=await createClient(); const q=(params.q??'').trim(); const status=params.status??'';
  let documents:DocumentItem[]=[]; let vendors:VendorItem[]=[]; let contracts:ContractItem[]=[]; let assets:AssetItem[]=[]; let services:ServiceItem[]=[]; let expenses:ExpenseOption[]=[]; let loadError=false;
  if(resident){
    const result=await supabase.rpc('list_resident_documents',{p_limit:PAGE_SIZE,p_offset:from}); loadError=!!result.error; documents=(result.data??[]) as DocumentItem[];
  } else if(tab==='documents') {
    let query=supabase.from('society_documents').select('id,title,category,description,document_date,published_to_residents,archived_at,created_at,updated_at').eq('society_id',auth.societyId).is('archived_at',null); if(q) query=query.or(`title.ilike.%${q}%,description.ilike.%${q}%`); if(params.category) query=query.eq('category',params.category as DocumentItem['category']); const result=await query.order('created_at',{ascending:false}).order('id',{ascending:false}).range(from,to); loadError=!!result.error; documents=(result.data??[]) as DocumentItem[];
  } else if(tab==='vendors') {
    let vendorQuery = supabase.from('vendors').select('id,name,service_category,contact_name,phone,email,address,notes,archived_at,created_at,updated_at').eq('society_id',auth.societyId).is('archived_at',null);
    if (q) vendorQuery = vendorQuery.or(`name.ilike.%${q}%,service_category.ilike.%${q}%`);
    let statusVendorIds: string[] | null = null;
    let statusLookupFailed = false;
    if (status) {
      try {
        const matchingContracts = await fetchAll<{ id: string; vendor_id: string }>((statusFrom, statusTo) =>
          supabase.from('vendor_contracts').select('id,vendor_id').eq('society_id', auth.societyId).is('archived_at', null).eq('status', status as ContractItem['status']).order('vendor_id').order('id').range(statusFrom, statusTo),
        );
        statusVendorIds = [...new Set(matchingContracts.map(contract => contract.vendor_id))];
      } catch {
        statusLookupFailed = true;
      }
    }
    if (status) vendorQuery = vendorQuery.in('id', statusVendorIds ?? []);
    const [v, e] = await Promise.all([
      vendorQuery.order('name').order('id').range(from, to),
      supabase.from('expenditures').select('id,expense_date,description,amount').eq('society_id',auth.societyId).eq('is_voided',false).order('expense_date',{ascending:false}).order('id',{ascending:false}).limit(100),
    ]);
    const vendorIds = (v.data ?? []).map(vendor => vendor.id);
    const c = vendorIds.length ? await supabase.from('vendor_contracts').select('id,vendor_id,title,contract_value,start_date,end_date,renewal_notice_days,status,notes,archived_at,created_at,updated_at').eq('society_id',auth.societyId).is('archived_at',null).in('vendor_id', vendorIds).order('created_at',{ascending:false}).order('id',{ascending:false}) : { data: [], error: null };
    loadError=!!(statusLookupFailed||v.error||c.error||e.error); vendors=(v.data??[]) as VendorItem[]; contracts=(c.data??[]) as ContractItem[]; expenses=(e.data??[]) as ExpenseOption[];
  } else {
    let assetQuery = supabase.from('assets').select('id,vendor_id,name,category,location,purchase_date,warranty_expires_on,next_service_date,status,notes,archived_at,created_at,updated_at').eq('society_id',auth.societyId).is('archived_at',null);
    if (q) assetQuery = assetQuery.or(`name.ilike.%${q}%,category.ilike.%${q}%,location.ilike.%${q}%`);
    if (status) assetQuery = assetQuery.eq('status', status as AssetItem['status']);
    const [a,v,e]=await Promise.all([
      assetQuery.order('created_at',{ascending:false}).order('id',{ascending:false}).range(from,to),
      supabase.from('vendors').select('id,name,service_category,contact_name,phone,email,address,notes,archived_at,created_at,updated_at').eq('society_id',auth.societyId).is('archived_at',null).order('name').limit(100),
      supabase.from('expenditures').select('id,expense_date,description,amount').eq('society_id',auth.societyId).eq('is_voided',false).order('expense_date',{ascending:false}).limit(100),
    ]); const assetIds=(a.data??[]).map(asset=>asset.id); const s=assetIds.length ? await supabase.from('asset_service_records').select('id,asset_id,vendor_id,service_date,next_service_date,description,amount,notes,archived_at,created_at,updated_at').eq('society_id',auth.societyId).is('archived_at',null).in('asset_id',assetIds).order('service_date',{ascending:false}).order('id',{ascending:false}) : { data: [], error: null }; loadError=!!(a.error||s.error||v.error||e.error); assets=(a.data??[]) as AssetItem[]; services=(s.data??[]) as ServiceItem[]; vendors=(v.data??[]) as VendorItem[]; expenses=(e.data??[]) as ExpenseOption[];
  }
  // Capture "more beyond this page" from the raw fetch before the in-memory q/category/status
  // filters below reassign these arrays to a possibly-shorter filtered subset.
  // Nested collections share this page's range, so a full child page also means "more beyond here".
  const hasMore=tab==='documents'?documents.length===PAGE_SIZE:tab==='vendors'?vendors.length===PAGE_SIZE:assets.length===PAGE_SIZE;
  const canWrite=!resident&&hasCapability(auth.role,'operations_write');
  const pageHref=(p:number)=>{const next=new URLSearchParams(); next.set('tab',tab); if(params.q)next.set('q',params.q); if(params.category)next.set('category',params.category); if(params.status)next.set('status',params.status); if(p>1)next.set('page',String(p)); return societyPath(auth.societySlug,`/operations?${next.toString()}`);};
  return <div className="space-y-4">
    <OperationsTabs active={tab} resident={resident}/>
    {loadError?<div role="status" className="rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-[var(--text-sm)] text-[var(--sf-label2)]">Operations records are unavailable right now. Refresh and try again.</div>:<>
      {tab==='documents'?<DocumentsContent items={documents} canWrite={canWrite} resident={resident}/>:tab==='vendors'?<VendorsContent vendors={vendors} contracts={contracts} expenses={expenses} canWrite={canWrite}/>:<AssetsContent assets={assets} services={services} vendors={vendors} expenses={expenses} canWrite={canWrite}/>}
      {(page>1||hasMore)&&<nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--sf-border)] pt-3">
        <span className="text-[var(--text-xs)] text-[var(--sf-label3)]">Page {page}</span>
        <div className="flex gap-2">
          {page>1&&<Link href={pageHref(page-1)} className="flex min-h-11 items-center rounded-[var(--radius-md)] border border-[var(--sf-border)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--sf-label2)] hover:bg-[var(--sf-bg)]">Previous</Link>}
          {hasMore&&<Link href={pageHref(page+1)} className="flex min-h-11 items-center rounded-[var(--radius-md)] border border-[var(--sf-border)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--sf-label2)] hover:bg-[var(--sf-bg)]">Next</Link>}
        </div>
      </nav>}
    </>}
  </div>;
}
