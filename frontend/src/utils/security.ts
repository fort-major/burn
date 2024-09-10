import { bigIntToBytes, bytesToHex, debugStringify, numberToBytes, strToBytes } from "./encoding";
import { ErrorCode, err } from "./error";
import { ONE_MIN_NS, ONE_SEC_NS } from "./types";
import { fromCBOR, hexToBytes, Principal, toCBOR } from "@fort-major/msq-shared";
import { Agent } from "@fort-major/agent-js-fork";
import { ShopId } from "@store/shops";

export function eventHandler<E extends Event>(fn: (e: E) => void | Promise<void>) {
  return (e: E) => {
    if (!e.isTrusted) {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();

      err(ErrorCode.SECURITY_VIOLATION, "No automation allowed!");
    }

    Promise.resolve(fn(e)).catch((e) => console.error(ErrorCode.UNKNOWN, debugStringify(e)));
  };
}
