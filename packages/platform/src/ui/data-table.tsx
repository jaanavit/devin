import Link from "next/link";
import type { ReactNode } from "react";
import { PAGE_SIZES, type SearchParams, type TableParams } from "../table-params";
import { cn } from "./cn";
import { Button, Input, Label, Select } from "./primitives";

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  className?: string;
  render: (row: T) => ReactNode;
}

/** Builds `basePath?…` preserving current params with overrides (undefined removes a key). */
export function hrefWith(basePath: string, current: SearchParams, overrides: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value !== undefined && value !== "") params.set(k, value);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === "") params.delete(k);
    else params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export interface DataTableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  total: number;
  params: TableParams;
  basePath: string;
  searchParams: SearchParams;
  emptyMessage?: string;
}

/** Server-rendered table: pagination, sorting and filters are driven by URL search params. */
export function DataTable<T>({ columns, rows, rowKey, total, params, basePath, searchParams, emptyMessage = "No results." }: DataTableProps<T>) {
  const pages = Math.max(1, Math.ceil(total / params.pageSize));
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((col) => {
                const active = params.sort === col.key;
                const nextDir = active && params.dir === "desc" ? "asc" : "desc";
                return (
                  <th key={col.key} scope="col" className={cn("px-4 py-2 text-left font-medium text-slate-600", col.className)}>
                    {col.sortable ? (
                      <Link href={hrefWith(basePath, searchParams, { sort: col.key, dir: nextDir, page: 1 })} className="inline-flex items-center gap-1 hover:text-slate-900">
                        {col.header}
                        <span aria-hidden className="text-xs">{active ? (params.dir === "desc" ? "▼" : "▲") : "↕"}</span>
                      </Link>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-slate-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={rowKey(row)} className="hover:bg-slate-50">
                  {columns.map((col) => (
                    <td key={col.key} className={cn("px-4 py-2 align-top", col.className)}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
        <span>
          {total.toLocaleString()} result{total === 1 ? "" : "s"} · page {params.page} of {pages.toLocaleString()}
        </span>
        <div className="flex items-center gap-3">
          <span className="flex gap-1">
            {PAGE_SIZES.map((size) => (
              <Link key={size} href={hrefWith(basePath, searchParams, { pageSize: size, page: 1 })} className={cn("rounded px-2", size === params.pageSize ? "bg-slate-200 font-medium" : "hover:bg-slate-100")}>
                {size}
              </Link>
            ))}
          </span>
          <PageLink disabled={params.page <= 1} href={hrefWith(basePath, searchParams, { page: params.page - 1 })} label="Previous" />
          <PageLink disabled={params.page >= pages} href={hrefWith(basePath, searchParams, { page: params.page + 1 })} label="Next" />
        </div>
      </div>
    </div>
  );
}

function PageLink({ disabled, href, label }: { disabled: boolean; href: string; label: string }) {
  if (disabled) return <span className="text-slate-400">{label}</span>;
  return (
    <Link href={href} className="font-medium text-slate-900 hover:underline">
      {label}
    </Link>
  );
}

export type FilterField =
  | { type: "text" | "date"; name: string; label: string; placeholder?: string }
  | { type: "select"; name: string; label: string; options: readonly { value: string; label: string }[] };

/** GET form that writes filters to the URL (resetting to page 1) for a `DataTable`. */
export function FilterBar({ fields, searchParams, basePath }: { fields: readonly FilterField[]; searchParams: SearchParams; basePath: string }) {
  const value = (name: string) => {
    const v = searchParams[name];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const keep = ["sort", "dir", "pageSize"].filter((k) => value(k));
  return (
    <form method="get" action={basePath} className="mb-4 flex flex-wrap items-end gap-3">
      {keep.map((k) => (
        <input key={k} type="hidden" name={k} value={value(k)} />
      ))}
      {fields.map((f) => (
        <div key={f.name} className="flex min-w-40 flex-col gap-1">
          <Label htmlFor={`filter-${f.name}`}>{f.label}</Label>
          {f.type === "select" ? (
            <Select id={`filter-${f.name}`} name={f.name} defaultValue={value(f.name)}>
              <option value="">Any</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input id={`filter-${f.name}`} name={f.name} type={f.type} defaultValue={value(f.name)} placeholder={f.type === "text" ? f.placeholder : undefined} />
          )}
        </div>
      ))}
      <Button type="submit">Apply</Button>
      <Link href={basePath} className="h-9 px-2 text-sm leading-9 text-slate-600 hover:underline">
        Reset
      </Link>
    </form>
  );
}
