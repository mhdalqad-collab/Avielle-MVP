"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "./shared";

export const savedWardrobeLimit = 24;
const keyPrefix = "avielle:saved-wardrobe:v1:";
type Snapshot = { ids: string[]; ready: boolean; error?: string };
type Store = { snapshot: Snapshot; listeners: Set<() => void> };
const empty: Snapshot = { ids: [], ready: false };
const signedOut: Snapshot = { ids: [], ready: true };
const stores = new Map<string, Store>();
let subscriberCount = 0;

function key(accountId: string) {
  return `${keyPrefix}${encodeURIComponent(accountId)}`;
}

function storeFor(accountId: string): Store {
  let store = stores.get(accountId);
  if (!store) {
    store = { snapshot: empty, listeners: new Set() };
    stores.set(accountId, store);
  }
  return store;
}

function parsedIds(raw: string | null): string[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error("Invalid saved wardrobe");
  return Array.from(
    new Set(
      value.filter(
        (id): id is string =>
          typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id),
      ),
    ),
  ).slice(0, savedWardrobeLimit);
}

function publish(store: Store, snapshot: Snapshot) {
  const previous = store.snapshot;
  const sameIds =
    previous.ids.length === snapshot.ids.length &&
    previous.ids.every((id, index) => id === snapshot.ids[index]);
  if (
    sameIds &&
    previous.ready === snapshot.ready &&
    previous.error === snapshot.error
  )
    return;
  store.snapshot = { ...snapshot, ids: sameIds ? previous.ids : snapshot.ids };
  for (const listener of store.listeners) listener();
}

function readStore(accountId: string) {
  const store = storeFor(accountId);
  try {
    publish(store, {
      ids: parsedIds(window.localStorage.getItem(key(accountId))),
      ready: true,
    });
  } catch {
    publish(store, {
      ids: store.snapshot.ids,
      ready: true,
      error:
        "Your browser could not open saved pieces. Check its storage settings.",
    });
  }
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && !event.key.startsWith(keyPrefix)) return;
  for (const [accountId, store] of stores) {
    if (!store.listeners.size) continue;
    if (event.key === null || event.key === key(accountId))
      readStore(accountId);
  }
}

function subscribe(accountId: string | null, listener: () => void) {
  if (!accountId) return () => {};
  const store = storeFor(accountId);
  store.listeners.add(listener);
  if (subscriberCount++ === 0) window.addEventListener("storage", onStorage);
  readStore(accountId);
  return () => {
    store.listeners.delete(listener);
    if (--subscriberCount === 0)
      window.removeEventListener("storage", onStorage);
  };
}

function writeIds(accountId: string, ids: string[]): boolean {
  const store = storeFor(accountId);
  try {
    window.localStorage.setItem(key(accountId), JSON.stringify(ids));
    publish(store, { ids, ready: true });
    return true;
  } catch {
    publish(store, {
      ...store.snapshot,
      ready: true,
      error:
        "This browser could not save the piece. Check its storage settings and try again.",
    });
    return false;
  }
}

/** Device-local saved IDs only. Listing details always come from the real API. */
export function useSavedWardrobe() {
  const auth = useAuth();
  const accountId = auth.user?.id || null;
  const [localError, setLocalError] = useState<string>();
  const subscribeAccount = useCallback(
    (listener: () => void) => subscribe(accountId, listener),
    [accountId],
  );
  const getSnapshot = useCallback(
    () => (accountId ? storeFor(accountId).snapshot : signedOut),
    [accountId],
  );
  const snapshot = useSyncExternalStore(
    subscribeAccount,
    getSnapshot,
    () => empty,
  );
  useEffect(() => setLocalError(undefined), [accountId]);

  const change = useCallback(
    (id: string, operation: "save" | "remove" | "toggle") => {
      setLocalError(undefined);
      if (!accountId) {
        setLocalError("Sign in to save pieces on this device.");
        return false;
      }
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return false;
      const store = storeFor(accountId);
      // Read before writing so another tab's recent saves are preserved.
      readStore(accountId);
      const ids = store.snapshot.ids;
      const exists = ids.includes(id);
      const remove =
        operation === "remove" || (operation === "toggle" && exists);
      if (remove)
        return writeIds(
          accountId,
          ids.filter((item) => item !== id),
        );
      if (exists) return writeIds(accountId, ids);
      if (ids.length >= savedWardrobeLimit) {
        publish(store, {
          ...store.snapshot,
          error: `You can save up to ${savedWardrobeLimit} pieces on this device. Remove one to make room.`,
        });
        return false;
      }
      return writeIds(accountId, [id, ...ids]);
    },
    [accountId],
  );
  const save = useCallback((id: string) => change(id, "save"), [change]);
  const remove = useCallback((id: string) => change(id, "remove"), [change]);
  const toggle = useCallback((id: string) => change(id, "toggle"), [change]);
  const isSaved = useCallback(
    (id: string) => snapshot.ids.includes(id),
    [snapshot.ids],
  );
  return {
    ids: snapshot.ids,
    ready: snapshot.ready && !auth.loading,
    error: localError || snapshot.error,
    save,
    remove,
    toggle,
    isSaved,
  };
}
