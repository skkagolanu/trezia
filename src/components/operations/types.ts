import type { Asset, AssetServiceRecord, SocietyAttachment, SocietyDocument, Vendor, VendorContract } from '@/types/database';

export type AttachmentSummary = Pick<SocietyAttachment, 'id' | 'filename' | 'content_type' | 'byte_size' | 'created_at'>;
export type DocumentItem = Pick<SocietyDocument, 'id' | 'title' | 'category' | 'description' | 'document_date' | 'published_to_residents' | 'archived_at' | 'created_at' | 'updated_at'>;
export type VendorItem = Pick<Vendor, 'id' | 'name' | 'service_category' | 'contact_name' | 'phone' | 'email' | 'address' | 'notes' | 'archived_at' | 'created_at' | 'updated_at'>;
export type ContractItem = Pick<VendorContract, 'id' | 'vendor_id' | 'title' | 'contract_value' | 'start_date' | 'end_date' | 'renewal_notice_days' | 'status' | 'notes' | 'archived_at' | 'created_at' | 'updated_at'>;
export type AssetItem = Pick<Asset, 'id' | 'vendor_id' | 'name' | 'category' | 'location' | 'purchase_date' | 'warranty_expires_on' | 'next_service_date' | 'status' | 'notes' | 'archived_at' | 'created_at' | 'updated_at'>;
export type ServiceItem = Pick<AssetServiceRecord, 'id' | 'asset_id' | 'vendor_id' | 'service_date' | 'next_service_date' | 'description' | 'amount' | 'notes' | 'archived_at' | 'created_at' | 'updated_at'>;
export type ExpenseOption = { id: string; expense_date: string; description: string; amount: number };
export type ParentType = 'document' | 'contract' | 'asset' | 'service' | 'notice';
