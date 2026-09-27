import { useEffect, useReducer, useRef } from "preact/hooks";

/** A tiny observable state container. State is replaced, never mutated. */
export class Store<S extends object> {
  private listeners = new Set<() => void>();

  constructor(public state: S) {}

  set(update: Partial<S> | ((s: S) => Partial<S>)): void {
    const patch = typeof update === "function" ? update(this.state) : update;
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Re-renders the component when the selected slice changes (compared with Object.is). */
export function useStore<S extends object, T>(store: Store<S>, select: (s: S) => T): T {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const selectRef = useRef(select);
  selectRef.current = select;
  const value = select(store.state);
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(
    () =>
      store.subscribe(() => {
        const next = selectRef.current(store.state);
        if (!Object.is(next, valueRef.current)) force(0);
      }),
    [store],
  );
  return value;
}
