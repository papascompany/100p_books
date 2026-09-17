/**
 * 결제·주문 테스트용 인메모리 Supabase 흉내 (테스트 전용 — 앱 코드에서 import 금지).
 *
 *   - PostgREST 빌더: select/insert/update/delete + eq/neq/is/in/lt/gt/or/order/limit,
 *     maybeSingle/single, count/head.
 *   - 한 문장은 동기 실행(원자적)이지만 실행 직전 microtask 를 양보해 동시 요청이 섞인다.
 *   - unique 제약(23505), 없는 컬럼(42703/PGRST204), 없는 RPC(PGRST202) 흉내.
 *   - auth.admin.getUserById — authUsers 맵 조회.
 *   - 0033 reserve_order_credits / release_order_credits 와 기존 포인트·할인 RPC 를
 *     SQL 과 같은 규칙으로 흉내 낸다(RPC 한 번 = 트랜잭션 한 번).
 *
 * `_test` 폴더는 Next.js 비공개 폴더라 라우트가 되지 않는다.
 */

export type Row = Record<string, unknown>;
export interface DbError {
  code?: string;
  message: string;
}
type Result = { data: unknown; error: DbError | null; count?: number | null };
type RpcHandler = (args: Record<string, unknown>, db: MemoryDb) => Result;
export interface AuthUserStub {
  id: string;
  email?: string;
}

type FilterOp = "eq" | "neq" | "is" | "in" | "lt" | "gt";
interface Filter {
  op: FilterOp;
  column: string;
  value: unknown;
}

export interface MemoryDbOptions {
  /** table → 없는 컬럼 (마이그레이션 미적용 흉내). */
  missingColumns?: Record<string, string[]>;
  /** table → unique 컬럼 묶음. */
  uniques?: Record<string, string[][]>;
}

let idSeq = 0;
function newId(): string {
  idSeq += 1;
  const hex = idSeq.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

let clockSeq = 0;
function tickIso(): string {
  clockSeq += 1;
  return new Date(Date.now() + clockSeq).toISOString();
}

function readColumn(row: Row, column: string): unknown {
  if (column.includes("->>")) {
    const [col, key] = column.split("->>") as [string, string];
    const obj = row[col];
    if (obj && typeof obj === "object") {
      const v = (obj as Record<string, unknown>)[key];
      return v === undefined || v === null ? null : String(v);
    }
    return null;
  }
  return row[column];
}

function looseEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

function compare(a: unknown, b: unknown): number {
  const da = typeof a === "string" ? Date.parse(a) : Number.NaN;
  const dbv = typeof b === "string" ? Date.parse(b) : Number.NaN;
  if (Number.isFinite(da) && Number.isFinite(dbv)) return da - dbv;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function matchFilter(row: Row, f: Filter): boolean {
  const v = readColumn(row, f.column);
  switch (f.op) {
    case "eq":
      return looseEqual(v, f.value);
    case "neq":
      // SQL: NULL <> x 는 NULL(거짓)
      return v !== null && v !== undefined && !looseEqual(v, f.value);
    case "is":
      return f.value === null ? v === null || v === undefined : v === f.value;
    case "in":
      return (f.value as unknown[]).some((x) => looseEqual(v, x));
    case "lt":
      return v !== null && v !== undefined && compare(v, f.value) < 0;
    case "gt":
      return v !== null && v !== undefined && compare(v, f.value) > 0;
  }
}

function parseOr(expr: string): Filter[] {
  return expr.split(",").map((part) => {
    const first = part.indexOf(".");
    const second = part.indexOf(".", first + 1);
    const column = part.slice(0, first);
    const op = part.slice(first + 1, second) as FilterOp;
    let raw: string = part.slice(second + 1);
    if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
    const value: unknown = op === "is" && raw === "null" ? null : raw;
    return { op, column, value };
  });
}

export class MemoryDb {
  tables: Record<string, Row[]> = {};
  rpcs: Record<string, RpcHandler> = {};
  /** 호출 로그 — "rpc:name" / "update:table" 등. */
  calls: string[] = [];
  /** 다음 1회 실패 주입: key = "update:orders" | "rpc:reserve_order_credits" 등. */
  failOnce = new Map<string, DbError>();
  /** auth.users 흉내 — getUserById 대상. */
  authUsers = new Map<string, AuthUserStub>();
  readonly missingColumns: Record<string, string[]>;
  readonly uniques: Record<string, string[][]>;

  constructor(opts: MemoryDbOptions = {}) {
    this.missingColumns = opts.missingColumns ?? {};
    this.uniques = opts.uniques ?? {};
  }

  table(name: string): Row[] {
    if (!this.tables[name]) this.tables[name] = [];
    return this.tables[name]!;
  }

  seed(name: string, row: Row): Row {
    const full: Row = { id: newId(), ...row };
    this.table(name).push(full);
    return full;
  }

  find(name: string, pred: (r: Row) => boolean): Row | undefined {
    return this.table(name).find(pred);
  }

  client(): {
    from: (t: string) => QueryBuilder;
    rpc: (fn: string, args: Record<string, unknown>) => Promise<Result>;
    auth: {
      admin: {
        getUserById: (
          id: string,
        ) => Promise<{ data: { user: AuthUserStub | null }; error: DbError | null }>;
      };
    };
  } {
    return {
      auth: {
        admin: {
          getUserById: async (id: string) => {
            await Promise.resolve();
            const key = "auth:getUserById";
            this.calls.push(key);
            const injected = this.failOnce.get(key);
            if (injected) {
              this.failOnce.delete(key);
              return { data: { user: null }, error: injected };
            }
            return { data: { user: this.authUsers.get(id) ?? null }, error: null };
          },
        },
      },
      from: (t: string) => new QueryBuilder(this, t),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        await Promise.resolve();
        const key = `rpc:${fn}`;
        this.calls.push(key);
        const injected = this.failOnce.get(key);
        if (injected) {
          this.failOnce.delete(key);
          return { data: null, error: injected };
        }
        const h = this.rpcs[fn];
        if (!h) {
          return {
            data: null,
            error: { code: "PGRST202", message: `Could not find the function public.${fn}` },
          };
        }
        return h(args, this);
      },
    };
  }

  /** 테이블 unique 위반 여부. */
  violatesUnique(name: string, candidate: Row, ignore?: Row): boolean {
    for (const cols of this.uniques[name] ?? []) {
      const clash = this.table(name).some(
        (r) =>
          r !== ignore &&
          cols.every(
            (c) =>
              candidate[c] !== null &&
              candidate[c] !== undefined &&
              looseEqual(r[c], candidate[c]),
          ),
      );
      if (clash) return true;
    }
    return false;
  }
}

class QueryBuilder implements PromiseLike<Result> {
  private action: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | Row[] = {};
  private columns = "*";
  private returning = false;
  private countMode = false;
  private head = false;
  private filters: Filter[] = [];
  private orGroups: Filter[][] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private singleMode: "single" | "maybeSingle" | null = null;

  constructor(
    private readonly db: MemoryDb,
    private readonly tableName: string,
  ) {}

  select(cols = "*", opts?: { count?: string; head?: boolean }): this {
    if (this.action === "select") {
      this.columns = cols;
      this.countMode = Boolean(opts?.count);
      this.head = Boolean(opts?.head);
    } else {
      this.returning = true;
      this.columns = cols;
    }
    return this;
  }
  insert(values: Row | Row[]): this {
    this.action = "insert";
    this.payload = values;
    return this;
  }
  update(patch: Row): this {
    this.action = "update";
    this.payload = patch;
    return this;
  }
  delete(): this {
    this.action = "delete";
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push({ op: "eq", column, value });
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push({ op: "neq", column, value });
    return this;
  }
  is(column: string, value: unknown): this {
    this.filters.push({ op: "is", column, value });
    return this;
  }
  in(column: string, value: unknown[]): this {
    this.filters.push({ op: "in", column, value });
    return this;
  }
  lt(column: string, value: unknown): this {
    this.filters.push({ op: "lt", column, value });
    return this;
  }
  or(expr: string): this {
    this.orGroups.push(parseOr(expr));
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: opts?.ascending ?? true };
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  maybeSingle(): Promise<Result> {
    this.singleMode = "maybeSingle";
    return this.run();
  }
  single(): Promise<Result> {
    this.singleMode = "single";
    return this.run();
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private referencedColumns(): { read: string[]; write: string[] } {
    const read = [
      ...this.columns
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c && c !== "*"),
      ...this.filters.map((f) => f.column),
      ...this.orGroups.flat().map((f) => f.column),
    ];
    const write =
      this.action === "update" || this.action === "insert"
        ? (Array.isArray(this.payload) ? this.payload : [this.payload]).flatMap((r) =>
            Object.keys(r),
          )
        : [];
    return { read, write };
  }

  private matches(row: Row): boolean {
    return (
      this.filters.every((f) => matchFilter(row, f)) &&
      this.orGroups.every((g) => g.some((f) => matchFilter(row, f)))
    );
  }

  private async run(): Promise<Result> {
    await Promise.resolve();
    const key = `${this.action}:${this.tableName}`;
    this.db.calls.push(key);
    const injected = this.db.failOnce.get(key);
    if (injected) {
      this.db.failOnce.delete(key);
      return { data: null, error: injected };
    }

    const missing = this.db.missingColumns[this.tableName] ?? [];
    if (missing.length > 0) {
      const { read, write } = this.referencedColumns();
      const w = write.find((c) => missing.includes(c));
      if (w) {
        return { data: null, error: { code: "PGRST204", message: `column ${w} not found` } };
      }
      const r = read.find((c) => missing.includes(c));
      if (r) {
        return { data: null, error: { code: "42703", message: `column ${r} does not exist` } };
      }
    }

    const table = this.db.table(this.tableName);
    let rows: Row[];

    if (this.action === "insert") {
      const values = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted: Row[] = [];
      for (const v of values) {
        const now = tickIso();
        const row: Row = { id: newId(), created_at: now, updated_at: now, ...v };
        if (this.db.violatesUnique(this.tableName, row)) {
          return {
            data: null,
            error: { code: "23505", message: "duplicate key value violates unique constraint" },
          };
        }
        table.push(row);
        inserted.push(row);
      }
      rows = inserted;
    } else if (this.action === "update") {
      rows = table.filter((r) => this.matches(r));
      for (const r of rows) {
        Object.assign(r, this.payload as Row);
        if ("updated_at" in r) r.updated_at = tickIso();
      }
    } else if (this.action === "delete") {
      rows = table.filter((r) => this.matches(r));
      this.db.tables[this.tableName] = table.filter((r) => !rows.includes(r));
    } else {
      rows = table.filter((r) => this.matches(r));
      if (this.orderBy) {
        const { column, ascending } = this.orderBy;
        rows = [...rows].sort((a, b) => compare(a[column], b[column]) * (ascending ? 1 : -1));
      }
      if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    }

    const count = rows.length;
    const copies = rows.map((r) => ({ ...r }));
    if (this.action !== "select" && !this.returning) {
      return { data: null, error: null, count };
    }
    if (this.head) return { data: null, error: null, count };
    if (this.singleMode) {
      if (copies.length > 1) {
        return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
      }
      if (copies.length === 0) {
        return this.singleMode === "single"
          ? { data: null, error: { code: "PGRST116", message: "no rows" } }
          : { data: null, error: null };
      }
      return { data: copies[0], error: null, count };
    }
    return { data: copies, error: null, count: this.countMode ? count : null };
  }
}

// =====================================================================
// RPC 흉내
// =====================================================================

function ledgerHeld(db: MemoryDb, orderId: string): number {
  const net = db
    .table("point_ledger")
    .filter(
      (l) =>
        l.ref_type === "orders" &&
        l.ref_id === orderId &&
        (l.reason === "order_use" || l.reason === "order_refund"),
    )
    .reduce((acc, l) => acc + Number(l.amount), 0);
  return -net;
}

function balanceRow(db: MemoryDb, userId: string): Row {
  let row = db.find("user_points", (r) => r.user_id === userId);
  if (!row) row = db.seed("user_points", { user_id: userId, balance: 0 });
  return row;
}

function ledger(db: MemoryDb, userId: string, amount: number, reason: string, refId: unknown, after: number): void {
  db.seed("point_ledger", {
    user_id: userId,
    amount,
    reason,
    ref_type: refId ? "orders" : null,
    ref_id: refId ?? null,
    balance_after: after,
    created_at: tickIso(),
  });
}

/** 기존(0023/0022/0019) RPC — 마이그레이션 적용 여부와 무관하게 존재. */
export function installBaseRpcs(db: MemoryDb): void {
  db.rpcs.deduct_user_points_v2 = (a) => {
    const amount = Number(a.p_amount);
    const row = db.find("user_points", (r) => r.user_id === a.p_user_id);
    if (!row || Number(row.balance) < amount) return { data: -1, error: null };
    row.balance = Number(row.balance) - amount;
    ledger(db, String(a.p_user_id), -amount, String(a.p_reason), a.p_ref_id, Number(row.balance));
    return { data: row.balance, error: null };
  };
  db.rpcs.add_user_points_v2 = (a) => {
    const amount = Number(a.p_amount);
    const row = balanceRow(db, String(a.p_user_id));
    row.balance = Number(row.balance) + amount;
    ledger(db, String(a.p_user_id), amount, String(a.p_reason), a.p_ref_id, Number(row.balance));
    return { data: row.balance, error: null };
  };
  db.rpcs.increment_discount_used = (a) => {
    const code = db.find("discount_codes", (r) => r.id === a.p_code_id);
    if (
      !code ||
      code.active !== true ||
      (code.max_uses !== null && Number(code.used_count) >= Number(code.max_uses))
    ) {
      return { data: null, error: { code: "P0001", message: "DISCOUNT_LIMIT_REACHED" } };
    }
    code.used_count = Number(code.used_count) + 1;
    return { data: null, error: null };
  };
  db.rpcs.award_referral_reward_v2 = () => ({ data: null, error: null });
}

/** 0033 RPC — SQL 과 같은 판정 순서. */
export function installCreditRpcs(db: MemoryDb): void {
  db.rpcs.reserve_order_credits = (a) => {
    const order = db.find("orders", (r) => r.id === a.p_order_id);
    const out = (o: Row): Result => ({ data: o, error: null });
    if (!a.p_payment_key) return out({ ok: false, code: "INVALID_ARGS" });
    if (!order) return out({ ok: false, code: "NOT_FOUND" });
    if (order.status !== "pending") return out({ ok: false, code: "NOT_PENDING", status: order.status });
    if (order.amount !== a.p_amount || order.toss_order_id !== a.p_toss_order_id) {
      return out({ ok: false, code: "ORDER_CHANGED" });
    }
    if (order.toss_payment_key && order.toss_payment_key !== a.p_payment_key) {
      return out({ ok: false, code: "PAYMENT_KEY_CONFLICT" });
    }
    const pointsUsed = Number(order.points_used ?? 0);
    const held = ledgerHeld(db, String(order.id));
    const uses = db.table("discount_uses").filter((u) => u.order_id === order.id);
    if (
      (held !== 0 && held !== pointsUsed) ||
      uses.length > 1 ||
      (uses.length === 1 && uses[0]!.code_id !== order.discount_code_id)
    ) {
      return out({ ok: false, code: "CREDITS_STATE_INVALID" });
    }
    const need = pointsUsed - held;
    const reserveDisc = Boolean(order.discount_code_id) && uses.length === 0;
    let code: Row | undefined;
    if (reserveDisc) {
      code = db.find("discount_codes", (r) => r.id === order.discount_code_id);
      if (!code) return out({ ok: false, code: "DISCOUNT_INVALID", reason: "not_found" });
      if (code.active !== true) return out({ ok: false, code: "DISCOUNT_INVALID", reason: "inactive" });
      if (code.expires_at && Date.parse(String(code.expires_at)) <= Date.now()) {
        return out({ ok: false, code: "DISCOUNT_INVALID", reason: "expired" });
      }
      if (code.max_uses !== null && Number(code.used_count) >= Number(code.max_uses)) {
        return out({ ok: false, code: "DISCOUNT_INVALID", reason: "limit_reached" });
      }
      if (
        db.table("discount_uses").some((u) => u.code_id === code!.id && u.user_id === order.user_id)
      ) {
        return out({ ok: false, code: "DISCOUNT_INVALID", reason: "already_used" });
      }
    }
    let bal: Row | undefined;
    if (need > 0) {
      bal = db.find("user_points", (r) => r.user_id === order.user_id);
      const balance = Number(bal?.balance ?? 0);
      if (balance < need) {
        return out({ ok: false, code: "POINTS_INSUFFICIENT", balance, requested: need });
      }
    }
    if (reserveDisc && code) {
      db.seed("discount_uses", { code_id: code.id, user_id: order.user_id, order_id: order.id });
      code.used_count = Number(code.used_count) + 1;
    }
    if (need > 0 && bal) {
      bal.balance = Number(bal.balance) - need;
      ledger(db, String(order.user_id), -need, "order_use", order.id, Number(bal.balance));
    }
    if (!order.toss_payment_key) {
      order.toss_payment_key = a.p_payment_key;
      order.updated_at = tickIso();
    }
    return out({ ok: true, pointsReserved: Math.max(need, 0), discountReserved: reserveDisc });
  };

  db.rpcs.release_order_credits = (a) => {
    const order = db.find("orders", (r) => r.id === a.p_order_id);
    const out = (o: Row): Result => ({ data: o, error: null });
    if (!order) return out({ ok: false, code: "NOT_FOUND" });
    if (a.p_mode === "abort") {
      if (order.status !== "pending") return out({ ok: false, code: "NOT_PENDING", status: order.status });
      if (!a.p_payment_key || order.toss_payment_key !== a.p_payment_key) {
        return out({ ok: false, code: "PAYMENT_KEY_MISMATCH" });
      }
    } else if (a.p_mode === "refund") {
      if (order.status !== "refunded" && order.status !== "cancelled") {
        return out({ ok: false, code: "NOT_RELEASABLE_STATE", status: order.status });
      }
    } else {
      return out({ ok: false, code: "INVALID_MODE" });
    }
    const uses = db.table("discount_uses").filter((u) => u.order_id === order.id);
    db.tables.discount_uses = db.table("discount_uses").filter((u) => u.order_id !== order.id);
    for (const u of uses) {
      const code = db.find("discount_codes", (r) => r.id === u.code_id);
      if (code) code.used_count = Math.max(Number(code.used_count) - 1, 0);
    }
    const held = ledgerHeld(db, String(order.id));
    if (held > 0) {
      const bal = balanceRow(db, String(order.user_id));
      bal.balance = Number(bal.balance) + held;
      ledger(db, String(order.user_id), held, "order_refund", order.id, Number(bal.balance));
    }
    if (a.p_mode === "abort" && a.p_clear_payment_key !== false) {
      order.toss_payment_key = null;
      order.updated_at = tickIso();
    }
    return out({ ok: true, pointsRestored: Math.max(held, 0), discountUsesRestored: uses.length });
  };
}
