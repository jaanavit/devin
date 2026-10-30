export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => formatCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => formatCell(c.value(row))).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
