import { cn } from "@/lib/utils";
import * as React from "react";

/**
 * 가벼운 관리자 데이터 테이블.
 * - sticky header
 * - zebra rows
 * - 빈 상태 노출
 *
 * Column.cell 은 row → ReactNode 매핑. cell 미지정 시 row[col.key] 표시.
 */
export interface Column<T> {
  key: keyof T & string;
  header: React.ReactNode;
  className?: string;
  cell?: (row: T) => React.ReactNode;
  /** 헤더 셀 가운데 정렬 등 */
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: React.ReactNode;
  className?: string;
}

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  className,
}: DataTableProps<T>) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border bg-card shadow-soft",
        className,
      )}
    >
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground",
                    c.headerClassName,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-10 text-center text-sm text-muted-foreground"
                >
                  {empty ?? "데이터가 없습니다."}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className="odd:bg-background even:bg-muted/20 hover:bg-accent/40"
                >
                  {columns.map((c) => {
                    const v = c.cell ? c.cell(row) : (row[c.key] as React.ReactNode);
                    return (
                      <td
                        key={c.key}
                        className={cn(
                          "border-b px-3 py-2 align-middle",
                          c.className,
                        )}
                      >
                        {v}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
