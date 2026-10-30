import type { ReactNode } from "react";
import { Card } from "./primitives";

export interface DetailSection {
  title: string;
  fields: readonly { label: string; value: ReactNode }[];
  aside?: ReactNode;
}

export function DetailView({ sections }: { sections: readonly DetailSection[] }) {
  return (
    <div className="flex flex-col gap-4">
      {sections.map((s) => (
        <Card key={s.title} className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{s.title}</h2>
            {s.aside}
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {s.fields.map((f) => (
              <div key={f.label}>
                <dt className="text-xs text-slate-500">{f.label}</dt>
                <dd className="mt-0.5 text-sm text-slate-900">{f.value ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ))}
    </div>
  );
}
