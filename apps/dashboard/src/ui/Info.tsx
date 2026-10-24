import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** (i) button: hover or focus shows the note, a click pins it (that's how touch screens open it). */
export function Info({ label, children }: { label: string; children: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  const place = () => {
    const b = btn.current, t = tip.current;
    if (!b || !t) return;
    const r = b.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight;
    const left = Math.min(Math.max(16, r.left + r.width / 2 - w / 2), window.innerWidth - 16 - w);
    const below = r.bottom + 10 + h < window.innerHeight;
    setPos({ left, top: below ? r.bottom + 10 : r.top - 10 - h });
  };
  useLayoutEffect(() => {
    if (open) place();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setPinned(false);
    };
    const onDoc = (e: MouseEvent) => {
      if (!btn.current?.contains(e.target as Node) && !tip.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="info"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? "tip" : undefined}
        onMouseEnter={() => !pinned && setOpen(true)}
        onMouseLeave={() => !pinned && setOpen(false)}
        onFocus={() => !pinned && setOpen(true)}
        onBlur={() => !pinned && setOpen(false)}
        onClick={() => {
          if (pinned) {
            setPinned(false);
            setOpen(false);
          } else {
            setPinned(true);
            setOpen(true);
          }
        }}
      >
        i
      </button>
      {open &&
        createPortal(
          <div ref={tip} id="tip" role="tooltip" className="tip on" style={{ left: pos.left, top: pos.top }}>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
