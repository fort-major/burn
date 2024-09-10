import { toast } from "solid-toast";

export enum ErrorCode {
  AUTH = "AUTH",
  SECURITY_VIOLATION = "SECURITY_VIOLATION",
  UNREACHEABLE = "UNREACHEABLE",
  UNKNOWN = "UNKNOWN",
  ICRC1 = "ICRC1",
  NETWORK = "NETWORK",
  VALIDATION = "VALIDATION",
}

export function err(code: ErrorCode, msg?: string): never {
  const str = `[code: ${code}]${msg ? `: ${msg}` : ""}`;

  toast.error(str);
  throw new Error(str);
}

export function logErr(code: ErrorCode, msg?: string) {
  const str = `[code: ${code}]${msg ? `: ${msg}` : ""}`;

  console.error(str);
  toast.error(str, { position: "bottom-center" });
}

export function logInfo(msg: string) {
  console.info(msg);
  toast(msg, { position: "bottom-center" });
}

const WAIT_MSGS = [
  "Please, wait!",
  "We're almost there!",
  "Stand by!",
  "I'm not stuck :)",
  "Keep waiting!",
  "A bit more...",
];

export function randomWaitingMessage() {
  return WAIT_MSGS[Math.floor(Math.random() * WAIT_MSGS.length)];
}
