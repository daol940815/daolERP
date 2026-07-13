export interface VendorStatusRow {
  vendor_id: string | null
  vendor_name: string
  biz_number: string | null
  count: number
  total_amount: number
  matched_count: number
  matched_amount: number
  remaining: number
}
