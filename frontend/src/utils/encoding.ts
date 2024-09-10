import { match } from "assert";
import { SwapFrom, VotingId } from "../declarations/votings/votings.did";
import { ErrorCode, err } from "./error";
import { Principal } from "@dfinity/principal";
import { IPair, TPairStr } from "../store/bank";
import { SwapInto } from "../declarations/bank/bank.did";
import { TVotingIdStr } from "@store/votings";

export { Principal } from "@dfinity/principal";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * ## Encodes a utf-8 string as {@link Uint8Array}
 *
 * @see {@link bytesToStr}
 *
 * @param str
 * @returns
 */
export const strToBytes = (str: string): Uint8Array => textEncoder.encode(str);

/**
 * ## Decodes a {@link Uint8Array} into a utf-8 string
 *
 * @see {@link strToBytes}
 *
 * @param bytes
 * @returns
 */
export const bytesToStr = (bytes: Uint8Array): string =>
  textDecoder.decode(bytes);

/**
 * ## Encodes {@link Uint8Array} into hex-string
 *
 * @see {@link hexToBytes}
 *
 * @param bytes
 * @returns
 */
export const bytesToHex = (bytes: Uint8Array): string =>
  bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, "0"), "");

/**
 * ## Decodes {@link Uint8Array} from hex-string
 *
 * @see {@link bytesToHex}
 *
 * @param hexString
 * @returns
 */
export const hexToBytes = (hexString: string): Uint8Array => {
  const matches = hexString.match(/[a-f0-9]{2}/g) ?? [];
  const result = Uint8Array.from(matches.map((byte) => parseInt(byte, 16)));

  if (
    matches === null ||
    hexString.length % 2 !== 0 ||
    result.length !== hexString.length / 2
  )
    throw new Error("Invalid hexstring");

  return result;
};

/**
 * ## Encodes bigint as bytes (le)
 *
 * @param n
 * @returns
 */
export const bigIntToBytes = (n: bigint): Uint8Array => {
  let result = [];

  while (n > 0n) {
    result.push(Number(n % 256n));
    n = n / 256n;
  }

  return new Uint8Array(result);
};

/**
 * ## Encodes integer as bytes (le)
 *
 * @param n
 * @returns
 */
export const numberToBytes = (n: number, sizeBytes?: number): Uint8Array => {
  let result = [];

  while (n > 0) {
    result.push(Number(n % 256));
    n = Math.floor(n / 256);
  }

  if (sizeBytes === undefined || sizeBytes === result.length) {
    return new Uint8Array(result);
  }

  if (sizeBytes < result.length) {
    err(ErrorCode.UNREACHEABLE, "Invalid padding size");
  }

  return new Uint8Array([
    ...result,
    ...Array(sizeBytes - result.length).fill(0),
  ]);
};

/**
 * ## Decodes a bigint from bytes (le)
 *
 * @param bytes
 * @returns
 */
export const bytesToBigInt = (bytes: Uint8Array): bigint => {
  let result = 0n;
  let base = 1n;
  for (let byte of bytes) {
    result = result + base * BigInt(byte);
    base = base * 256n;
  }
  return result;
};

/**
 * Returns pretty-string of a token amount
 * For example, 1001000 e8s would transform into 1.001, and 1001001000 e8s - into 1`001.001
 *
 * @param {bigint} qty - the amount of tokens
 * @param {number} decimals - the position of decimal point of this token
 * @param {number} floor - if undefined, all meaningless zeros at the end will be removed, if set to some number less than {decimals}, will floor down to that number of digits after the point
 * @param {boolean} insertQuotes - if true, the result's whole part will be separated by thousands with quotemarks
 * @returns {string}
 */
export function tokensToStr(
  qty: bigint,
  decimals: number,
  floor: number | undefined = undefined,
  insertQuotes: boolean = false,
  allowEmptyTail: boolean = false
): string {
  // 0.0 -> 0
  if (qty === BigInt(0)) {
    return allowEmptyTail ? "0.0" : "0";
  }

  // todo: Math.pow() to bitshift
  const decimalDiv = BigInt(Math.pow(10, decimals));

  const head = qty / decimalDiv;
  const tail = qty % decimalDiv;

  let headFormatted = head.toString();

  // 1000000.0 -> 1'000'000.0
  if (insertQuotes) {
    headFormatted = headFormatted.replace(
      /\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g,
      "'"
    );
  }

  // 1,000.0 -> 1,000
  if (tail === BigInt(0)) {
    return allowEmptyTail ? headFormatted + ".0" : headFormatted;
  }

  // 1'000.10 -> 1'000.00000010
  const tailFormatted = tail.toString().padStart(decimals, "0");

  // 1'000.00012300 -> 1'000.000123
  let tailRounded: string = tailFormatted;
  if (floor === undefined) {
    while (tailRounded.charAt(tailRounded.length - 1) === "0") {
      tailRounded = tailRounded.slice(0, -1);
    }
  } else if (floor < decimals) {
    for (let i = 0; i < decimals - floor; i++) {
      tailRounded = tailRounded.slice(0, -1);
    }
  }

  return `${headFormatted}.${tailRounded}`;
}

/**
 * The reverse of [tokensToStr] function
 *
 * @param {string} str
 * @param {number} decimals
 * @returns {bigint}
 */
export function strToTokens(str: string, decimals: number): bigint {
  // 1'000.123 -> 1'000 & 123
  let [head, tail] = str.split(".") as [string, string | undefined];
  // 1'000 -> 1000
  head = head.replaceAll("'", "");

  // todo: Math.pow() to bitshift
  const decimalMul = BigInt(Math.pow(10, decimals));

  if (!tail) {
    return BigInt(head) * decimalMul;
  }

  // 00001000 -> 1000
  let i = 0;
  while (tail.charAt(0) === "0") {
    tail = tail.slice(1, tail.length);
    i++;
  }

  if (tail === "") {
    return BigInt(head) * decimalMul;
  }

  if (tail.length > decimals) {
    throw `Too many decimal digits (max ${decimals})`;
  }

  // 123 -> 12300000
  tail = tail.padEnd(decimals - i, "0");

  return BigInt(head) * decimalMul + BigInt(tail);
}

/**
 * Pretty-prints a JSON representation of the object, handling the bigint case
 *
 * @param obj
 * @returns
 */
export function debugStringify(obj: unknown): string {
  return JSON.stringify(
    obj,
    (_, value) => {
      if (typeof value === "bigint") {
        return value.toString();
      } else if (value instanceof Error) {
        const error: any = {};

        Object.getOwnPropertyNames(value).forEach(function (propName) {
          error[propName] = (value as any)[propName];
        });

        return error;
      } else {
        return value;
      }
    },
    2
  );
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function timestampToStr(timestamp: number | bigint) {
  const timestampMs =
    typeof timestamp === "bigint" ? Number(timestamp / 1000000n) : timestamp;

  const date = new Date(timestampMs);
  const day = date.getDate().toString().padStart(2, "0");
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear().toString();

  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");

  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

export function timestampToDMStr(timestamp: number | bigint) {
  const timestampMs =
    typeof timestamp === "bigint" ? Number(timestamp / 1000000n) : timestamp;

  const date = new Date(timestampMs);
  const day = date.getDate().toString().padStart(2, "0");
  const month = MONTHS[date.getMonth()];

  return `${day} ${month}`;
}

export function timestampToYearStr(timestamp: number | bigint) {
  const timestampMs =
    typeof timestamp === "bigint" ? Number(timestamp / 1000000n) : timestamp;

  const date = new Date(timestampMs);
  const year = date.getFullYear().toString();

  return `${year}`;
}

const VOTING_ID_STR_DELIMITER = ":::";

export function encodeVotingId(id: VotingId): string {
  if ("HumansEmploy" in id) {
    return `HumansEmploy${VOTING_ID_STR_DELIMITER}${id.HumansEmploy.toText()}`;
  }
  if ("HumansUnemploy" in id) {
    return `HumansUnemploy${VOTING_ID_STR_DELIMITER}${id.HumansUnemploy.toText()}`;
  }
  if ("EvaluateTask" in id) {
    return `EvaluateTask${VOTING_ID_STR_DELIMITER}${id.EvaluateTask.toString()}`;
  }
  if ("StartSolveTask" in id) {
    return `StartSolveTask${VOTING_ID_STR_DELIMITER}${id.StartSolveTask.toString()}`;
  }
  if ("DeleteTask" in id) {
    return `DeleteTask${VOTING_ID_STR_DELIMITER}${id.DeleteTask.toString()}`;
  }
  if ("BankSetExchangeRate" in id) {
    const [swapFrom, swapInto] = id.BankSetExchangeRate;

    const from = Object.keys(swapFrom)[0];
    const into = Object.keys(swapInto)[0];

    return `BankSetExchangeRate${VOTING_ID_STR_DELIMITER}${from}${VOTING_ID_STR_DELIMITER}${into}`;
  }

  err(ErrorCode.UNREACHEABLE, "Invalid voting id kind found");
}

export function decodeVotingId(idStr: string): VotingId {
  const [kind, ...args] = idStr.split(VOTING_ID_STR_DELIMITER);

  switch (kind) {
    case "HumansEmploy":
      return { HumansEmploy: Principal.fromText(args[0]) };
    case "HumansUnemploy":
      return { HumansUnemploy: Principal.fromText(args[0]) };
    case "EvaluateTask":
      return { EvaluateTask: BigInt(args[0]) };
    case "StartSolveTask":
      return { StartSolveTask: BigInt(args[0]) };
    case "DeleteTask":
      return { DeleteTask: BigInt(args[0]) };
    case "BankSetExchangeRate":
      return {
        // @ts-expect-error - invalid SwapFrom and SwapInto keys will fail on backend
        BankSetExchangeRate: [{ [args[0]]: null }, { [args[1]]: null }],
      };
    default:
      err(ErrorCode.UNREACHEABLE, "Invalid input string");
  }
}

export function pairToStr(pair: IPair): TPairStr {
  return `${pair.from}:::${pair.into}`;
}

export function strToPair(s: TPairStr): IPair {
  const [from, into] = s.split(":::");

  return { from, into };
}

export function wrapPair(from: SwapFrom, into: SwapInto): IPair {
  return {
    from: Object.keys(from)[0],
    into: Object.keys(into)[0],
  };
}

export function unwrapPair(pair: IPair): [SwapFrom, SwapInto] {
  // @ts-expect-error - invalid will be dropped on requests
  return [{ [pair.from]: null }, { [pair.into]: null }];
}
