/**
 * 수동으로 작성한 Supabase 테이블 타입.
 * M0 단계. 이후 `supabase gen types typescript` 로 `generated.ts` 를 만들고
 * 이 파일은 편의 별칭 (Project, Photo 등) 만 유지하도록 리팩터링.
 */

export type UserRole = "user" | "admin";

export type ProjectStatus = "draft" | "ordered";

export type LayoutMode = "polaroid" | "collage";

export type ResourceType = "font" | "clipart" | "background";

export type OrderStatus =
  | "pending"
  | "paid"
  | "in_production"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export interface Profile {
  id: string;
  email: string | null;
  role: UserRole;
  display_name: string | null;
  created_at: string;
  /** 회원 탈퇴 시각. NOT NULL 이면 익명화된 탈퇴 계정. */
  deleted_at: string | null;
  /** 탈퇴 사유 (선택) */
  deletion_reason: string | null;
  /** 이용약관 동의 시각 */
  terms_agreed_at: string | null;
  /** 개인정보 처리방침 동의 시각 */
  privacy_agreed_at: string | null;
}

export interface BookSize {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  cover_width_mm: number;
  cover_height_mm: number;
  spine_formula_per_page: number;
  active: boolean;
  display_order: number;
  created_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  book_size_id: string;
  title: string;
  status: ProjectStatus;
  cover_json: Record<string, unknown> | null;
  layout_mode: LayoutMode;
  created_at: string;
  updated_at: string;
}

export interface Photo {
  id: string;
  project_id: string;
  storage_key: string;
  thumb_key: string | null;
  filename: string | null;
  mime: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  exif_taken_at: string | null;
  exif_camera: string | null;
  order_idx: number;
  created_at: string;
}

export interface Page {
  id: string;
  project_id: string;
  page_no: number;
  layout_mode: LayoutMode;
  fabric_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Resource {
  id: string;
  type: ResourceType;
  name: string;
  storage_key: string;
  meta: Record<string, unknown> | null;
  active: boolean;
  created_at: string;
}

export interface OrderAddress {
  name: string;
  phone: string;
  zip: string;
  addr1: string;
  addr2?: string;
  memo?: string;
}

export interface Order {
  id: string;
  project_id: string;
  user_id: string;
  qty: number;
  amount: number;
  address: OrderAddress;
  status: OrderStatus;
  toss_payment_key: string | null;
  toss_order_id: string | null;
  cover_pdf_key: string | null;
  interior_pdf_key: string | null;
  paid_at: string | null;
  tracking_no: string | null;
  tracking_carrier: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Supabase client Database 제네릭에 넘길 얕은 스키마.
 * 실사용 (insert/select 페이로드 타입) 은 generated.ts 로 대체 예정.
 */
export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile> & { id: string }; Update: Partial<Profile> };
      book_sizes: { Row: BookSize; Insert: Omit<BookSize, "id" | "created_at"> & Partial<Pick<BookSize, "id" | "created_at">>; Update: Partial<BookSize> };
      projects: { Row: Project; Insert: Omit<Project, "id" | "created_at" | "updated_at"> & Partial<Pick<Project, "id">>; Update: Partial<Project> };
      photos: { Row: Photo; Insert: Omit<Photo, "id" | "created_at"> & Partial<Pick<Photo, "id">>; Update: Partial<Photo> };
      pages: { Row: Page; Insert: Omit<Page, "id" | "created_at"> & Partial<Pick<Page, "id">>; Update: Partial<Page> };
      resources: { Row: Resource; Insert: Omit<Resource, "id" | "created_at"> & Partial<Pick<Resource, "id">>; Update: Partial<Resource> };
      orders: { Row: Order; Insert: Omit<Order, "id" | "created_at" | "updated_at"> & Partial<Pick<Order, "id">>; Update: Partial<Order> };
    };
    Views: Record<string, never>;
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      anonymize_account: {
        Args: { p_user_id: string; p_reason?: string | null };
        Returns: null;
      };
      record_agreements: {
        Args: { p_user_id: string };
        Returns: null;
      };
    };
    Enums: Record<string, never>;
  };
}
