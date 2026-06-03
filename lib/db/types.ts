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
  /** 친구 추천 코드 (M16-4). 미발급 = null. 8자 대문자 + 숫자. */
  referral_code: string | null;
  /** OAuth 프로필 사진 URL (카카오/구글 등). */
  avatar_url: string | null;
  /** 가입 시 사용된 OAuth 프로바이더 ('kakao' | 'google' | 'email' | null). */
  oauth_provider: string | null;
}

/**
 * 포인트 거래 내역 (M16-7).
 * amount > 0 적립, amount < 0 사용. balance_after 는 거래 후 잔액.
 */
export type PointLedgerReason =
  | "attendance"
  | "attendance_bonus"
  | "referral_reward"
  | "order_use"
  | "order_refund"
  | "admin_adjust"
  | "welcome";

export interface PointLedger {
  id: string;
  user_id: string;
  amount: number;
  reason: PointLedgerReason;
  ref_type: string | null;
  ref_id: string | null;
  balance_after: number;
  memo: string | null;
  created_at: string;
}

export type ReferralRewardStatus = "pending" | "rewarded";

export interface Referral {
  id: string;
  referrer_id: string;
  referee_id: string | null;
  referral_code: string;
  reward_status: ReferralRewardStatus;
  created_at: string;
}

export interface UserPoints {
  user_id: string;
  balance: number;
  updated_at: string;
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
  /** 휴지통 이동 시각. NULL 이면 active. */
  deleted_at: string | null;
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

export type EmailJobStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export interface EmailJob {
  id: string;
  template: string;
  to_email: string;
  to_name: string | null;
  subject: string;
  body_text: string;
  body_html: string | null;
  context: Record<string, unknown>;
  status: EmailJobStatus;
  attempt: number;
  max_attempts: number;
  last_error: string | null;
  related_type: string | null;
  related_id: string | null;
  scheduled_at: string;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShareToken {
  id: string;
  project_id: string;
  token: string;
  expires_at: string | null;
  view_count: number;
  created_at: string;
}

export type GiftStatus = "pending" | "claimed" | "expired";

export interface Gift {
  id: string;
  order_id: string;
  sender_id: string;
  recipient_email: string;
  message: string | null;
  gift_token: string;
  status: GiftStatus;
  claimed_project_id: string | null;
  claimed_at: string | null;
  expires_at: string;
  created_at: string;
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
  /** 적용된 할인 코드 id (null = 미사용). */
  discount_code_id: string | null;
  /** 실제 할인 금액 (KRW). 0 = 미적용. */
  discount_amount: number;
  /** 사용된 포인트 (KRW). 0 = 미사용 (M16-4). */
  points_used: number;
  created_at: string;
  updated_at: string;
}

export type DiscountType = "percent" | "amount";

export interface DiscountCode {
  id: string;
  code: string;
  type: DiscountType;
  /** percent 의 경우 0 < value <= 100, amount 의 경우 양의 KRW 정수. */
  value: number;
  /** null = 무제한. */
  max_uses: number | null;
  used_count: number;
  /** null = 무기한. */
  expires_at: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface DiscountUse {
  id: string;
  code_id: string;
  user_id: string;
  order_id: string | null;
  used_at: string;
}

export interface Review {
  id: string;
  order_id: string;
  user_id: string;
  rating: number;
  body: string | null;
  image_keys: string[];
  likes_count: number;
  public: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReviewLike {
  id: string;
  review_id: string;
  user_id: string;
  created_at: string;
}

/**
 * 출석체크 (M16-6).
 * checked_date 는 KST 기준 YYYY-MM-DD.
 * month_key 는 'YYYY-MM' (인덱스/집계 편의용 — checked_date 의 prefix).
 */
export interface Attendance {
  id: string;
  user_id: string;
  checked_date: string;
  month_key: string;
  created_at: string;
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
      email_jobs: {
        Row: EmailJob;
        Insert: Omit<EmailJob, "id" | "created_at" | "updated_at"> &
          Partial<Pick<EmailJob, "id" | "created_at" | "updated_at">>;
        Update: Partial<EmailJob>;
      };
      share_tokens: {
        Row: ShareToken;
        Insert: Omit<ShareToken, "id" | "token" | "view_count" | "created_at"> &
          Partial<Pick<ShareToken, "id" | "token" | "view_count" | "created_at">>;
        Update: Partial<ShareToken>;
      };
      discount_codes: {
        Row: DiscountCode;
        Insert: Omit<DiscountCode, "id" | "used_count" | "created_at"> &
          Partial<Pick<DiscountCode, "id" | "used_count" | "created_at">>;
        Update: Partial<DiscountCode>;
      };
      discount_uses: {
        Row: DiscountUse;
        Insert: Omit<DiscountUse, "id" | "used_at"> &
          Partial<Pick<DiscountUse, "id" | "used_at">>;
        Update: Partial<DiscountUse>;
      };
      gifts: {
        Row: Gift;
        Insert: Omit<
          Gift,
          | "id"
          | "gift_token"
          | "status"
          | "claimed_project_id"
          | "claimed_at"
          | "expires_at"
          | "created_at"
        > &
          Partial<
            Pick<
              Gift,
              | "id"
              | "gift_token"
              | "status"
              | "claimed_project_id"
              | "claimed_at"
              | "expires_at"
              | "created_at"
              | "message"
            >
          >;
        Update: Partial<Gift>;
      };
      referrals: {
        Row: Referral;
        Insert: Omit<Referral, "id" | "created_at"> &
          Partial<Pick<Referral, "id" | "created_at" | "reward_status" | "referee_id">>;
        Update: Partial<Referral>;
      };
      user_points: {
        Row: UserPoints;
        Insert: Omit<UserPoints, "updated_at"> &
          Partial<Pick<UserPoints, "updated_at" | "balance">>;
        Update: Partial<UserPoints>;
      };
      reviews: {
        Row: Review;
        Insert: Omit<Review, "id" | "created_at" | "updated_at" | "likes_count"> &
          Partial<
            Pick<
              Review,
              | "id"
              | "created_at"
              | "updated_at"
              | "likes_count"
              | "image_keys"
              | "public"
              | "body"
            >
          >;
        Update: Partial<Review>;
      };
      review_likes: {
        Row: ReviewLike;
        Insert: Omit<ReviewLike, "id" | "created_at"> &
          Partial<Pick<ReviewLike, "id" | "created_at">>;
        Update: Partial<ReviewLike>;
      };
      attendances: {
        Row: Attendance;
        Insert: Omit<Attendance, "id" | "created_at"> &
          Partial<Pick<Attendance, "id" | "created_at">>;
        Update: Partial<Attendance>;
      };
      point_ledger: {
        Row: PointLedger;
        Insert: Omit<PointLedger, "id" | "created_at"> &
          Partial<Pick<PointLedger, "id" | "created_at">>;
        Update: Partial<PointLedger>;
      };
      site_content: {
        Row: {
          key: string;
          value: unknown;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          key: string;
          value: unknown;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          key?: string;
          value?: unknown;
          updated_at?: string;
          updated_by?: string | null;
        };
      };
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
      reorder_project_pages: {
        Args: { p_project_id: string; p_page_ids: string[] };
        Returns: number;
      };
      shift_pages_after: {
        Args: {
          p_project_id: string;
          p_after_page_no: number;
          p_shift?: number;
        };
        Returns: null;
      };
      increment_share_view: {
        Args: { token_val: string };
        Returns: number;
      };
      lookup_referral_code: {
        Args: { p_code: string };
        Returns: string | null;
      };
      ensure_user_points: {
        Args: { p_user_id: string };
        Returns: null;
      };
      award_referral_reward: {
        Args: { p_referee_id: string; p_reward: number };
        Returns: string | null;
      };
      deduct_user_points: {
        Args: { p_user_id: string; p_amount: number };
        Returns: number;
      };
      toggle_review_like: {
        Args: { p_review_id: string; p_user_id: string };
        Returns: { liked: boolean; likesCount: number };
      };
      increment_discount_used: {
        Args: { p_code_id: string };
        Returns: null;
      };
      add_user_points: {
        Args: { p_user_id: string; p_amount: number };
        Returns: null;
      };
      add_user_points_v2: {
        Args: {
          p_user_id: string;
          p_amount: number;
          p_reason: PointLedgerReason;
          p_ref_type?: string | null;
          p_ref_id?: string | null;
          p_memo?: string | null;
        };
        Returns: number;
      };
      deduct_user_points_v2: {
        Args: {
          p_user_id: string;
          p_amount: number;
          p_reason: PointLedgerReason;
          p_ref_type?: string | null;
          p_ref_id?: string | null;
          p_memo?: string | null;
        };
        Returns: number;
      };
      award_referral_reward_v2: {
        Args: { p_referee_id: string; p_reward: number };
        Returns: string | null;
      };
      sync_oauth_profile: {
        Args: { p_user_id: string };
        Returns: null;
      };
      get_user_dashboard_counts: {
        Args: { p_user_id: string };
        Returns: {
          order_count: number;
          project_count: number;
          active_photo_count: number;
          trash_photo_count: number;
        };
      };
    };
    Enums: Record<string, never>;
  };
}
