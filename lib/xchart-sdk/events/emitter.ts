/**
 * Typed event bus used by charts and sub-systems. Deterministic order (subscription order),
 * exception isolation, idempotent unsubscribe, and skips handlers removed during a delivery.
 */
export type Handler<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    if (typeof handler !== "function") throw new TypeError("handler must be a function");
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as Handler<never>);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      set!.delete(handler as Handler<never>);
    };
  }

  /** Like on(), but the handler runs at most once. */
  once<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    if (typeof handler !== "function") throw new TypeError("handler must be a function");
    const off = this.on(type, (p) => {
      off();
      handler(p);
    });
    return off;
  }

  has(type: keyof Events): boolean {
    return (this.handlers.get(type)?.size ?? 0) > 0;
  }

  count(type?: keyof Events): number {
    if (type) return this.handlers.get(type)?.size ?? 0;
    let n = 0;
    for (const s of this.handlers.values()) n += s.size;
    return n;
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (!set || !set.size) return;
    for (const h of [...set]) {
      if (!set.has(h)) continue; // unsubscribed earlier in this delivery
      try {
        (h as Handler<Events[K]>)(payload);
      } catch (err) {
        console.error(`[XChart] "${String(type)}" handler failed`, err);
      }
    }
  }

  clear() {
    this.handlers.clear();
  }
}
