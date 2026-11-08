"use client";

import { useSyncExternalStore } from "react";

/**
 * Tiny shared store so the animated board mock can tell the cycle card how
 * many extra issues it has moved into Done (the two mocks are siblings).
 */
let doneExtra = 0;
const listeners = new Set<() => void>();

export function setMockDoneExtra(value: number) {
  if (value === doneExtra) return;
  doneExtra = value;
  listeners.forEach((l) => l());
}

export function useMockDoneExtra(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => doneExtra,
    () => 0
  );
}
