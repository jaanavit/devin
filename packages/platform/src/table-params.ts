export type SearchParams = Record<string, string | string[] | undefined>;

export interface TableParams<S extends string = string> {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  sort: S;
  dir: "asc" | "desc";
  /** Single-valued string filters, trimmed; empty values dropped. */
  filters: Record<string, string>;
}

export const PAGE_SIZES = [25, 50, 100] as const;

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Parses URL search params into server-side pagination/sort/filter inputs. Sort keys are
 * restricted to `sortable` so user input never reaches `orderBy` unchecked.
 */
export function parseTableParams<S extends string>(
  searchParams: SearchParams,
  opts: { sortable: readonly S[]; defaultSort: S; defaultDir?: "asc" | "desc"; filterKeys?: readonly string[] },
): TableParams<S> {
  const pageSizeRaw = Number(firstParam(searchParams.pageSize));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(pageSizeRaw) ? pageSizeRaw : PAGE_SIZES[0];
  const page = Math.max(1, Math.floor(Number(firstParam(searchParams.page)) || 1));
  const sortRaw = firstParam(searchParams.sort);
  const sort = opts.sortable.find((s) => s === sortRaw) ?? opts.defaultSort;
  const dirRaw = firstParam(searchParams.dir);
  const dir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : (opts.defaultDir ?? "desc");
  const filters: Record<string, string> = {};
  for (const key of opts.filterKeys ?? []) {
    const value = firstParam(searchParams[key])?.trim();
    if (value) filters[key] = value;
  }
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize, sort, dir, filters };
}
