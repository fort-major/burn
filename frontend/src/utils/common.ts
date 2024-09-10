import { Accessor, createSignal, onCleanup, Setter } from "solid-js";
import deepEqual from "deep-equal";
import { Principal } from "@dfinity/principal";
import { fromCBOR, makeAvatarSvg, toCBOR } from "@fort-major/msq-shared";
import { COLORS } from "./colors";
import { bytesToHex, hexToBytes } from "./encoding";

export const debounce = (cb: (...args: any[]) => void, timeoutMs: number) => {
  const [int, setInt] = createSignal<NodeJS.Timeout | undefined>();

  onCleanup(() => {
    clearTimeout(int());
  });

  return (...args: [any]) => {
    setInt((i) => {
      clearTimeout(i);
      return setTimeout(() => cb(args), timeoutMs);
    });
  };
};

type Req<ID> = { ids: ID[] };
type Resp<T> = { entries: T[] };

export const debouncedBatchFetch = <ID, T, RESP extends Resp<T>>(
  fetcher: (req: Req<ID>) => AsyncGenerator<RESP, RESP, undefined>,
  onSuccess: (resp: RESP, req: Req<ID>, done?: boolean) => void,
  onErr: (reason: any, req: Req<ID>) => void
) => {
  let int: NodeJS.Timeout | undefined = undefined;
  let ids: ID[] = [];

  onCleanup(() => {
    clearTimeout(int);
  });

  const execute = async () => {
    const req = { ids: [...ids] };
    const gen = fetcher(req);

    ids = [];

    do {
      try {
        const { value: resp, done } = await gen.next();
        onSuccess(resp, req, done);

        if (done) return;
      } catch (e) {
        onErr(e, req);
      }
    } while (true);
  };

  return (req: { ids: ID[] }) => {
    pushAllDedup(ids, req.ids);

    if (ids.length >= 100) {
      clearTimeout(int);
      execute();
    } else {
      clearTimeout(int);
      int = setTimeout(execute, 100);
    }
  };
};

export function pushAllDedup<T>(dest: T[], src: T[]): void {
  for (let item of src) {
    const dup = dest.find((it) => deepEqual(it, item));

    if (!dup) {
      dest.push(item);
    }
  }
}

export function avatarSrcFromPrincipal(id: Principal) {
  const svg = btoa(makeAvatarSvg(id, COLORS.black));

  return `data:image/svg+xml;base64,${svg}`;
}

export function createLocalStorageSignal<T extends unknown>(key: string): [Accessor<T | undefined>, Setter<T>] {
  const storage = window.localStorage;
  const stored = storage.getItem(key);
  const initialValue: T | undefined = stored ? fromCBOR(stored) : undefined;

  const [value, setValue] = createSignal<T | undefined>(initialValue);

  const newSetValue = (newValue: T | ((v: T) => T)): T => {
    const _val: T =
      typeof newValue === "function"
        ? // @ts-expect-error
          newValue(value())
        : newValue;

    setValue(_val as any);
    storage.setItem(key, toCBOR({ value: _val }));

    return _val;
  };

  return [value, newSetValue as Setter<T>];
}

export const nowNs = () => BigInt(Date.now()) * 1000_0000n;
