import { JSX } from "solid-js";
import { err, ErrorCode } from "./error";
import { debugStringify } from "./encoding";
import deepEqual from "deep-equal";

export interface IChildren {
  children?: JSX.Element;
}

export interface IClass {
  class?: string;
}

export interface IRef<T> {
  ref?: T;
}

export type TTaskId = bigint;
export type TTaskTagId = number;
export type TTokenId = number;
export type TPrincipalStr = string;
export type TCommentId = number;

export type TE8s = bigint;
export type TTimestamp = bigint;
export type TMarkdown = string;

export const ONE_SEC_NS = 1_000_000_000n;
export const ONE_MIN_NS = ONE_SEC_NS * 60n;
export const ONE_HOUR_NS = ONE_MIN_NS * 60n;
export const ONE_DAY_NS = ONE_HOUR_NS * 24n;
export const ONE_WEEK_NS = ONE_DAY_NS * 7n;

type ResultMatchExprFn<T, R> = (v: T) => R;
type ResultMatchExpr<T, E, R> =
  | { Ok: ResultMatchExprFn<T, R>; Err: ResultMatchExprFn<E, R> }
  | { Ok: ResultMatchExprFn<T, R>; Err?: ResultMatchExprFn<E, R> }
  | { Ok?: ResultMatchExprFn<T, R>; Err: ResultMatchExprFn<E, R> };

export class Result<T, E = T> {
  private constructor(public value: { Ok: T } | { Err: E }) {}

  public static Ok<T, E = T>(v: T): Result<T, E> {
    return new Result({ Ok: v });
  }

  public static Err<T, E = T>(e: E): Result<T, E> {
    return new Result({ Err: e });
  }

  match<R>(expr: ResultMatchExpr<T, E, R>) {
    if (!("Ok" in expr) && !("Err" in expr)) {
      err(ErrorCode.UNREACHEABLE, "Empty match expr is not allowed");
    }

    if ("Ok" in this.value) {
      if ("Ok" in expr) {
        return expr.Ok!(this.value.Ok);
      }
    }

    if ("Err" in this.value) {
      if ("Err" in expr) {
        return expr.Err!(this.value.Err);
      }
    }
  }

  eq(other: Result<T, E>): boolean {
    if (this.isErr() && other.isErr()) {
      return deepEqual(this.unwrapErr(), other.unwrapErr(), { strict: true });
    } else if (this.isOk() && other.isOk()) {
      return deepEqual(this.unwrapOk(), other.unwrapOk(), { strict: true });
    } else {
      return false;
    }
  }

  map<T1>(fn: (v: T) => T1): Result<T1, E> {
    const self = this as unknown as Result<T1, E>;

    if ("Ok" in this.value) {
      (self.value as { Ok: T1 }).Ok = fn(this.value.Ok);
    }

    return self;
  }

  mapErr<E1>(fn: (e: E) => E1): Result<T, E1> {
    const self = this as unknown as Result<T, E1>;

    if ("Err" in this.value) {
      (self.value as { Err: E1 }).Err = fn(this.value.Err);
    }

    return self;
  }

  isOk(): boolean {
    return "Ok" in this.value;
  }

  isErr(): boolean {
    return "Err" in this.value;
  }

  unwrapOk(): T {
    if ("Err" in this.value)
      err(
        ErrorCode.UNREACHEABLE,
        `The Result is not Ok: ${debugStringify(this.value)}`
      );

    return this.value.Ok;
  }

  unwrapErr(): E {
    if ("Ok" in this.value)
      err(
        ErrorCode.UNREACHEABLE,
        `The Result is not Err: ${debugStringify(this.value)}`
      );

    return this.value.Err;
  }

  unwrap(): T | E {
    if ("Ok" in this.value) return this.value.Ok;
    else return this.value.Err;
  }

  expect(msg: string): T {
    if ("Err" in this.value) {
      err(
        ErrorCode.UNREACHEABLE,
        `${msg}: The result expected to be Ok: ${debugStringify(this.value)}`
      );
    }

    return this.value.Ok;
  }
}
