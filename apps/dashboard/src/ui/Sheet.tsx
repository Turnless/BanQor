import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Slide-over panel (a bottom sheet on phones): Test a draw, Add / Edit an agent. Escape, the × and a click on
 * the dimmed page close it; focus stays inside while it's open and returns to the opener after.
 */
export function Sheet({ open, onClose, title, sub, wide, children }: { open: boolean; onClose: () => void; title: string; sub?: string; wide?: boolean; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  // mounted lags `open` so the slide-out can finish before the panel leaves the page
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      opener.current = document.activeElement;
      setMounted(true);
      document.body.style.overflow = "hidden";
      const t = setTimeout(() => {
        setShown(true);
        const p = panel.current;
        (p?.querySelector<HTMLElement>("[data-autofocus]") ?? p?.querySelector<HTMLElement>("input:not([readonly]), select, button"))?.focus();
      }, 20);
      return () => clearTimeout(t);
    }
    setShown(false);
    document.body.style.overflow = "";
    (opener.current as HTMLElement | null)?.focus?.();
    const t = setTimeout(() => setMounted(false), 300);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => () => void (document.body.style.overflow = ""), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>("button, input, select, a[href]")].filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  return (
    <>
      <div className={`sheet-back${shown ? " open" : ""}`} onClick={onClose} />
      <aside ref={panel} className={`sheet${shown ? " open" : ""}${wide ? " sheet-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} aria-hidden={!shown}>
        <div className="sheet-head">
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button className="sheet-x" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </aside>
    </>
  );
}
