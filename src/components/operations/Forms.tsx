'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Archive, Pencil, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import Drawer from '@/components/ui/Drawer';
import { societyFetch } from '@/lib/society-path';
import { useRouter } from 'next/navigation';
import AttachmentManager from './AttachmentManager';
import type { AssetItem, ContractItem, DocumentItem, ExpenseOption, ParentType, ServiceItem, VendorItem } from './types';

const inputClass = 'min-h-11 w-full rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 text-[var(--text-sm)] text-[var(--sf-label)] outline-none focus:ring-2 focus:ring-[var(--sf-blue)]';
const textareaClass = `${inputClass} min-h-24 py-2`;
const labelClass = 'mb-1 block text-[var(--text-sm)] font-medium text-[var(--sf-label)]';
const nullable = (value: string) => value.trim() || null;

async function jsonRequest(path: string, init: RequestInit) {
  const response = await societyFetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
  const body = await response.json().catch(() => ({})) as { error?: string; issues?: Array<{ message?: string }> };
  if (!response.ok) throw new Error(body.issues?.[0]?.message ?? body.error ?? 'Unable to save. Please try again.');
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className={labelClass}>{label}</span>{children}</label>; }

function CrudDrawer({ title, triggerLabel, editing, endpoint, itemId, payload, children, parentType, onDone }: {
  title: string; triggerLabel: string; editing: boolean; endpoint: string; itemId?: string; payload: () => Record<string, unknown>;
  children: ReactNode; parentType?: ParentType; onDone?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false); const [saving, setSaving] = useState(false); const [archiving, setArchiving] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try { await jsonRequest(editing ? `${endpoint}/${itemId}` : endpoint, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload()) }); toast.success(editing ? 'Changes saved' : `${title} added`); setOpen(false); onDone?.(); router.refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save'); }
    finally { setSaving(false); }
  }
  async function archive() {
    if (!itemId || !window.confirm(`Archive this ${title.toLowerCase()}?`)) return;
    setArchiving(true);
    try { await jsonRequest(`${endpoint}/${itemId}`, { method: 'PATCH', body: JSON.stringify({ archive: true }) }); toast.success(`${title} archived`); setOpen(false); router.refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to archive'); }
    finally { setArchiving(false); }
  }
  return <>
    <Button type="button" variant={editing ? 'secondary' : 'primary'} className="min-h-11 w-full sm:w-auto" onClick={() => { setError(''); setOpen(true); }}>{editing ? <Pencil size={14} aria-hidden /> : <Plus size={15} aria-hidden />}{triggerLabel}</Button>
    <Drawer open={open} onClose={() => setOpen(false)} title={editing ? `Edit ${title.toLowerCase()}` : `Add ${title.toLowerCase()}`}>
      <form onSubmit={submit} className="space-y-4 p-4 sm:p-5">{children}
        {editing && itemId && parentType && <AttachmentManager parentType={parentType} parentId={itemId} canWrite />}
        {error && <p role="alert" className="rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--sf-red)_8%,transparent)] p-3 text-[var(--text-sm)] text-[var(--sf-red)]">{error}</p>}
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--sf-divider)] pt-4 sm:flex-row sm:justify-between">
          {editing ? <Button type="button" variant="ghost" className="min-h-11 text-[var(--sf-red)]" loading={archiving} onClick={archive}><Archive size={14} aria-hidden />Archive</Button> : <span />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row"><Button type="button" variant="secondary" className="min-h-11" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" className="min-h-11" loading={saving}>{editing ? 'Save changes' : 'Add'}</Button></div>
        </div>
      </form>
    </Drawer>
  </>;
}

export function DocumentForm({ item }: { item?: DocumentItem }) {
  const [title, setTitle] = useState(item?.title ?? ''); const [category, setCategory] = useState(item?.category ?? 'OTHER'); const [description, setDescription] = useState(item?.description ?? ''); const [date, setDate] = useState(item?.document_date ?? ''); const [published, setPublished] = useState(item?.published_to_residents ?? false);
  return <CrudDrawer title="Document" triggerLabel={item ? 'Edit' : 'Add document'} editing={!!item} endpoint="/api/documents" itemId={item?.id} parentType="document" payload={() => ({ title: title.trim(), category, description: nullable(description), document_date: nullable(date), published_to_residents: published })}>
    <Field label="Title"><input required minLength={2} maxLength={160} value={title} onChange={e => setTitle(e.target.value)} className={inputClass} /></Field>
    <Field label="Category"><select value={category} onChange={e => setCategory(e.target.value as DocumentItem['category'])} className={inputClass}>{[['BYLAWS','Bylaws'],['REGISTRATION','Registration'],['AUDIT_REPORT','Audit report'],['AGM_MINUTES','AGM minutes'],['CIRCULAR','Circular'],['FORM','Form'],['CONTRACT','Contract'],['OTHER','Other']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
    <Field label="Document date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputClass} /></Field>
    <Field label="Description"><textarea maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} className={textareaClass} /></Field>
    <label className="flex min-h-11 items-start gap-3 rounded-[var(--radius-md)] bg-[var(--sf-bg)] p-3"><input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} className="mt-1 h-4 w-4" /><span><span className="block text-[var(--text-sm)] font-medium text-[var(--sf-label)]">Publish to Residents</span><span className="text-[var(--text-xs)] text-[var(--sf-label3)]">Residents can read this record and download its file.</span></span></label>
  </CrudDrawer>;
}

export function VendorForm({ item }: { item?: VendorItem }) {
  const [name,setName]=useState(item?.name??''); const [category,setCategory]=useState(item?.service_category??''); const [contact,setContact]=useState(item?.contact_name??''); const [phone,setPhone]=useState(item?.phone??''); const [email,setEmail]=useState(item?.email??''); const [address,setAddress]=useState(item?.address??''); const [notes,setNotes]=useState(item?.notes??'');
  return <CrudDrawer title="Vendor" triggerLabel={item?'Edit':'Add vendor'} editing={!!item} endpoint="/api/vendors" itemId={item?.id} payload={() => ({ name:name.trim(), service_category:category.trim(), contact_name:nullable(contact), phone:nullable(phone), email:nullable(email), address:nullable(address), notes:nullable(notes) })}>
    <Field label="Vendor name"><input required minLength={2} maxLength={160} value={name} onChange={e=>setName(e.target.value)} className={inputClass}/></Field><Field label="Service category"><input required minLength={2} maxLength={100} value={category} onChange={e=>setCategory(e.target.value)} className={inputClass} placeholder="e.g. Lift maintenance"/></Field><Field label="Contact name"><input maxLength={150} value={contact} onChange={e=>setContact(e.target.value)} className={inputClass}/></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Phone"><input inputMode="tel" value={phone} onChange={e=>setPhone(e.target.value)} className={inputClass}/></Field><Field label="Email"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} className={inputClass}/></Field></div><Field label="Address"><textarea maxLength={500} value={address} onChange={e=>setAddress(e.target.value)} className={textareaClass}/></Field><Field label="Internal notes"><textarea maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)} className={textareaClass}/></Field>
  </CrudDrawer>;
}

export function ContractForm({ vendors, item }: { vendors: VendorItem[]; item?: ContractItem }) {
  const [vendor,setVendor]=useState(item?.vendor_id??vendors[0]?.id??''); const [title,setTitle]=useState(item?.title??''); const [value,setValue]=useState(item?.contract_value?.toString()??''); const [start,setStart]=useState(item?.start_date??''); const [end,setEnd]=useState(item?.end_date??''); const [days,setDays]=useState(item?.renewal_notice_days?.toString()??'30'); const [status,setStatus]=useState(item?.status??'ACTIVE'); const [notes,setNotes]=useState(item?.notes??'');
  return <CrudDrawer title="Contract" triggerLabel={item?'Edit':'Add contract'} editing={!!item} endpoint="/api/vendor-contracts" itemId={item?.id} parentType="contract" payload={() => ({ vendor_id:vendor, title:title.trim(), contract_value:value===''?null:Number(value), start_date:nullable(start), end_date:nullable(end), renewal_notice_days:Number(days), status, notes:nullable(notes) })}>
    <Field label="Vendor"><select required value={vendor} onChange={e=>setVendor(e.target.value)} className={inputClass}><option value="">Choose vendor</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></Field><Field label="Contract title"><input required minLength={2} maxLength={160} value={title} onChange={e=>setTitle(e.target.value)} className={inputClass}/></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Start date"><input type="date" value={start} onChange={e=>setStart(e.target.value)} className={inputClass}/></Field><Field label="End / renewal date"><input type="date" min={start||undefined} value={end} onChange={e=>setEnd(e.target.value)} className={inputClass}/></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Contract value"><input type="number" min="0" step="0.01" inputMode="decimal" value={value} onChange={e=>setValue(e.target.value)} className={inputClass}/></Field><Field label="Remind days before"><input type="number" min="0" max="365" value={days} onChange={e=>setDays(e.target.value)} className={inputClass}/></Field></div><Field label="Status"><select value={status} onChange={e=>setStatus(e.target.value as ContractItem['status'])} className={inputClass}>{['DRAFT','ACTIVE','EXPIRED','TERMINATED'].map(v=><option key={v}>{v.replace('_',' ')}</option>)}</select></Field><Field label="Notes"><textarea maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)} className={textareaClass}/></Field>
  </CrudDrawer>;
}

export function AssetForm({ vendors, item }: { vendors: VendorItem[]; item?: AssetItem }) {
  const [vendor,setVendor]=useState(item?.vendor_id??''); const [name,setName]=useState(item?.name??''); const [category,setCategory]=useState(item?.category??''); const [location,setLocation]=useState(item?.location??''); const [purchase,setPurchase]=useState(item?.purchase_date??''); const [warranty,setWarranty]=useState(item?.warranty_expires_on??''); const [service,setService]=useState(item?.next_service_date??''); const [status,setStatus]=useState(item?.status??'ACTIVE'); const [notes,setNotes]=useState(item?.notes??'');
  return <CrudDrawer title="Asset" triggerLabel={item?'Edit':'Add asset'} editing={!!item} endpoint="/api/assets" itemId={item?.id} parentType="asset" payload={() => ({ vendor_id:nullable(vendor), name:name.trim(), category:category.trim(), location:nullable(location), purchase_date:nullable(purchase), warranty_expires_on:nullable(warranty), next_service_date:nullable(service), status, notes:nullable(notes) })}>
    <Field label="Asset name"><input required minLength={2} maxLength={160} value={name} onChange={e=>setName(e.target.value)} className={inputClass}/></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Category"><input required minLength={2} maxLength={100} value={category} onChange={e=>setCategory(e.target.value)} className={inputClass}/></Field><Field label="Location"><input maxLength={200} value={location} onChange={e=>setLocation(e.target.value)} className={inputClass}/></Field></div><Field label="Responsible vendor"><select value={vendor} onChange={e=>setVendor(e.target.value)} className={inputClass}><option value="">None</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Purchase date"><input type="date" value={purchase} onChange={e=>setPurchase(e.target.value)} className={inputClass}/></Field><Field label="Warranty expires"><input type="date" value={warranty} onChange={e=>setWarranty(e.target.value)} className={inputClass}/></Field></div><Field label="Next service"><input type="date" value={service} onChange={e=>setService(e.target.value)} className={inputClass}/></Field><Field label="Status"><select value={status} onChange={e=>setStatus(e.target.value as AssetItem['status'])} className={inputClass}>{['ACTIVE','UNDER_REPAIR','OUT_OF_SERVICE','RETIRED'].map(v=><option key={v}>{v.replaceAll('_',' ')}</option>)}</select></Field><Field label="Notes"><textarea maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)} className={textareaClass}/></Field>
  </CrudDrawer>;
}

export function ServiceRecordForm({ asset, vendors, item }: { asset: AssetItem; vendors: VendorItem[]; item?: ServiceItem }) {
  const today=new Date().toISOString().slice(0,10); const [vendor,setVendor]=useState(item?.vendor_id??asset.vendor_id??''); const [date,setDate]=useState(item?.service_date??today); const [next,setNext]=useState(item?.next_service_date??''); const [description,setDescription]=useState(item?.description??''); const [amount,setAmount]=useState(item?.amount?.toString()??''); const [notes,setNotes]=useState(item?.notes??'');
  return <CrudDrawer title="Service record" triggerLabel={item?'Edit':'Record service'} editing={!!item} endpoint="/api/asset-services" itemId={item?.id} parentType="service" payload={() => ({ asset_id:asset.id, vendor_id:nullable(vendor), service_date:date, next_service_date:nullable(next), description:description.trim(), amount:amount===''?null:Number(amount), notes:nullable(notes) })}>
    <Field label="Asset"><input readOnly value={asset.name} className={`${inputClass} bg-[var(--sf-bg)]`}/></Field><Field label="Service date"><input required type="date" value={date} onChange={e=>setDate(e.target.value)} className={inputClass}/></Field><Field label="Description"><textarea required minLength={2} maxLength={1000} value={description} onChange={e=>setDescription(e.target.value)} className={textareaClass}/></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Vendor"><select value={vendor} onChange={e=>setVendor(e.target.value)} className={inputClass}><option value="">None</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></Field><Field label="Amount"><input type="number" min="0" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} className={inputClass}/></Field></div><Field label="Next service"><input type="date" min={date} value={next} onChange={e=>setNext(e.target.value)} className={inputClass}/></Field><Field label="Notes"><textarea maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)} className={textareaClass}/></Field>
  </CrudDrawer>;
}

export function ExpenseLinker({ parent, parentId, expenses }: { parent: 'vendor_contract_id'|'asset_id'|'asset_service_record_id'; parentId: string; expenses: ExpenseOption[] }) {
  const [expense,setExpense]=useState(''); const [busy,setBusy]=useState(false);
  useEffect(()=>setExpense(''),[parentId]);
  async function link(){ if(!expense)return; setBusy(true); const target = parent === 'vendor_contract_id' ? { vendor_contract_id: parentId } : parent === 'asset_id' ? { asset_id: parentId } : { asset_service_record_id: parentId }; try{await jsonRequest('/api/operational-expense-links',{method:'POST',body:JSON.stringify({expenditure_id:expense,...target})});toast.success('Expense linked');setExpense('');}catch(caught){toast.error(caught instanceof Error?caught.message:'Unable to link expense');}finally{setBusy(false);}}
  return <div className="flex flex-col gap-2 border-t border-[var(--sf-divider)] pt-3 sm:flex-row"><select aria-label="Related expense" value={expense} onChange={e=>setExpense(e.target.value)} className={inputClass}><option value="">Link a related expense…</option>{expenses.map(e=><option key={e.id} value={e.id}>{e.expense_date} · {e.description} · ₹{Number(e.amount).toLocaleString('en-IN')}</option>)}</select><Button type="button" variant="secondary" className="min-h-11" loading={busy} disabled={!expense} onClick={link}>Link</Button></div>;
}
