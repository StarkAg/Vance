import { Children, useEffect, type ReactNode } from "react";
import { Icon } from "./icons";

// Use as a Stat value: <Count value={totalNet} format={money} />
export function Count({ value, format }: { value: number; format: (n: number) => string }) {
  return <>{format(value)}</>;
}

// Wraps a row of <Stat> items in one unified card instead of rendering each
// stat as its own floating box. On mobile an even number of stats lays out as
// a 2-column grid (2 rows for 4 stats); an odd count (e.g. 3, as on the
// Dashboard) stacks full-width instead, so there's no dangling half-empty
// row. From sm up it's always a single row. No divider lines between items.
export function StatGroup({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  const n = items.length;
  const cols = n > 1 && n % 2 === 0 ? 2 : 1;
  return (
    <div className="card overflow-hidden p-0">
      <div className={`grid ${cols === 2 ? "grid-cols-2" : "grid-cols-1"} sm:flex sm:flex-row`}>
        {items.map((child, i) => (
          <div key={i} className="min-w-0 sm:flex-1">
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "good" | "bad";
}) {
  const toneClass = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-slate-100";
  return (
    <div className="min-w-0 flex-1 p-3 sm:p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 break-words text-xl font-bold tracking-tight sm:text-2xl ${toneClass}`}>{value}</div>
      {sub != null && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto overflow-x-hidden bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="card flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-b-none rounded-t-2xl p-4 shadow-2xl sm:max-h-[88dvh] sm:rounded sm:p-5">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded text-muted hover:bg-panel2 hover:text-slate-200" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">{children}</div>
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

export function ConfirmDelete({ onConfirm }: { onConfirm: () => void }) {
  return (
    <button
      onClick={() => {
        if (confirm("Delete this entry?")) onConfirm();
      }}
      className="grid h-9 w-9 place-items-center rounded text-muted hover:bg-panel2 hover:text-bad"
      title="Delete"
      aria-label="Delete"
    >
      <Icon name="trash" />
    </button>
  );
}
