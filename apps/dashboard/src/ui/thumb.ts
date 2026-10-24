import { useEffect, type RefObject } from "react";

/**
 * One thumb that slides under the hovered or focused item and settles back on the current one
 * (the page tabs, Owner-only switches, the Manage-the-line actions). `current` is the index of the selected item.
 */
export function useSlideThumb(ref: RefObject<HTMLElement | null>, itemSelector: string, current: number, deps: unknown[] = []) {
  useEffect(() => {
    const group = ref.current;
    if (!group) return;
    const items = [...group.querySelectorAll<HTMLElement>(itemSelector)].filter((el) => el.offsetParent !== null);
    const home = items[current];
    const thumb = document.createElement("span");
    thumb.className = "thumb";
    thumb.setAttribute("aria-hidden", "true");
    group.prepend(thumb);
    group.classList.add("has-thumb");
    const place = (el: HTMLElement | undefined) => {
      thumb.style.width = el ? el.offsetWidth + "px" : "0px";
      if (el) thumb.style.transform = `translateX(${el.offsetLeft}px)`;
      items.forEach((i) => i.classList.toggle("lit", i === el));
    };
    place(home);
    const raf = requestAnimationFrame(() => group.classList.add("ready"));
    const offs: (() => void)[] = [];
    const on = (el: EventTarget, ev: string, fn: (e: Event) => void) => {
      el.addEventListener(ev, fn);
      offs.push(() => el.removeEventListener(ev, fn));
    };
    items.forEach((el) => {
      on(el, "mouseenter", () => place(el));
      on(el, "focus", () => place(el));
    });
    on(group, "mouseleave", () => place(home));
    on(group, "focusout", (e) => {
      if (!group.contains((e as FocusEvent).relatedTarget as Node)) place(home);
    });
    on(window, "resize", () => place(home));
    document.fonts?.ready.then(() => place(home));
    return () => {
      cancelAnimationFrame(raf);
      offs.forEach((f) => f());
      thumb.remove();
      group.classList.remove("has-thumb", "ready");
      items.forEach((i) => i.classList.remove("lit"));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, itemSelector, ...deps]);
}
