import { strToTokens, tokensToStr } from "./encoding";
import { ErrorCode, err } from "./error";
import { ONE_DAY_NS, ONE_HOUR_NS, ONE_MIN_NS } from "./types";

export class E8s {
  protected val: EDs;

  constructor(val: bigint) {
    if (val < 0n) {
      err(ErrorCode.UNREACHEABLE, "Unable to negate E8s");
    }

    this.val = EDs.new(val, 8);
  }

  public static base() {
    return 1_0000_0000n;
  }

  public static new(val: bigint) {
    return new E8s(val);
  }

  public eq(b: E8s): boolean {
    return this.val.eq(b.val);
  }

  public gt(b: E8s): boolean {
    return this.val.gt(b.val);
  }

  public ge(b: E8s): boolean {
    return this.val.ge(b.val);
  }

  public lt(b: E8s): boolean {
    return this.val.lt(b.val);
  }

  public le(b: E8s): boolean {
    return this.val.le(b.val);
  }

  public static zero(): E8s {
    return E8s.new(0n);
  }

  public static one(): E8s {
    return E8s.new(E8s.base());
  }

  public static f0_05(): E8s {
    return E8s.new(E8s.base() / 20n);
  }

  public static f0_1(): E8s {
    return E8s.new(E8s.base() / 10n);
  }

  public static f0_2(): E8s {
    return E8s.new(E8s.base() / 5n);
  }

  public static f0_25(): E8s {
    return E8s.new(EDs.base() / 4n);
  }

  public static f0_3(): E8s {
    return E8s.new((E8s.base() * 3n) / 10n);
  }

  public static f0_33(): E8s {
    return E8s.new(E8s.base() / 3n);
  }

  public static f0_4(): E8s {
    return E8s.new((E8s.base() * 2n) / 5n);
  }

  public static f0_5(): E8s {
    return E8s.new(E8s.base() / 2n);
  }

  public static f0_6(): E8s {
    return E8s.new((E8s.base() * 3n) / 5n);
  }

  public static f0_67(): E8s {
    return E8s.new((E8s.base() * 2n) / 3n);
  }

  public static f0_7(): E8s {
    return E8s.new((E8s.base() * 7n) / 10n);
  }

  public static f0_75(): E8s {
    return E8s.new((E8s.base() * 3n) / 4n);
  }

  public static f0_8(): E8s {
    return E8s.new((E8s.base() * 4n) / 5n);
  }

  public static f0_9(): E8s {
    return E8s.new((E8s.base() * 9n) / 10n);
  }

  public add(b: E8s): E8s {
    return E8s.new(this.val.add(b.val).val);
  }

  public sub(b: E8s): E8s {
    return E8s.new(this.val.sub(b.val).val);
  }

  public mul(b: E8s): E8s {
    return E8s.new(this.val.mul(b.val).val);
  }

  public mulNum(b: bigint): E8s {
    return E8s.new(this.val.mulNum(b).val);
  }

  public div(b: E8s): E8s {
    return E8s.new(this.val.div(b.val).val);
  }

  public divNum(b: bigint): E8s {
    return E8s.new(this.val.divNum(b).val);
  }

  public toString() {
    return this.val.toString();
  }

  public static fromString(s: string): E8s {
    return E8s.new(EDs.fromString(s, 8).val);
  }

  public toDynamic(): EDs {
    return EDs.new(this.val.val, 8);
  }

  public toBool() {
    return this.val.toBool();
  }

  public isZero() {
    return this.val.isZero();
  }

  public toBigIntRaw() {
    return this.val.toBigIntRaw();
  }

  public static fromBigIntBase(x: bigint) {
    return E8s.new(EDs.fromBigIntBase(x, 8).val);
  }

  public toBigIntBase() {
    return this.val.toBigIntBase();
  }

  public static fromPercentNum(p: number) {
    return E8s.new(EDs.fromPercentNum(p, 8).val);
  }

  public toPercentNum() {
    return this.val.toPercentNum();
  }

  public toPercent() {
    return this.val.toPercent();
  }
}

export class EDs {
  constructor(public val: bigint, public decimals: number) {
    if (val < 0n) {
      err(ErrorCode.UNREACHEABLE, "Unable to negate E8s");
    }
  }

  public static base(decimals?: number) {
    return 10n ** BigInt(decimals ?? 8);
  }

  private assertSameDecimals(b: EDs) {
    if (this.decimals !== b.decimals) {
      err(ErrorCode.UNREACHEABLE, "Invalid EDs operation: decimal point mismatch");
    }
  }

  public static new(val: bigint, decimals: number) {
    return new EDs(val, decimals);
  }

  public eq(b: EDs): boolean {
    this.assertSameDecimals(b);

    return this.val === b.val;
  }

  public gt(b: EDs): boolean {
    this.assertSameDecimals(b);

    return this.val > b.val;
  }

  public ge(b: EDs): boolean {
    this.assertSameDecimals(b);

    return this.val >= b.val;
  }

  public lt(b: EDs): boolean {
    this.assertSameDecimals(b);

    return this.val < b.val;
  }

  public le(b: EDs): boolean {
    this.assertSameDecimals(b);

    return this.val <= b.val;
  }

  public static zero(decimals: number): EDs {
    return EDs.new(0n, decimals);
  }

  public static one(decimals: number): EDs {
    return EDs.new(EDs.base(decimals), decimals);
  }

  public static f0_05(decimals: number): EDs {
    return EDs.new(EDs.base(decimals) / 20n, decimals);
  }

  public static f0_1(decimals: number): EDs {
    return EDs.new(EDs.base(decimals) / 10n, decimals);
  }

  public static f0_2(decimals: number): EDs {
    return EDs.new(EDs.base(decimals) / 5n, decimals);
  }

  public static f0_25(decimals: number): EDs {
    return EDs.new(EDs.base(decimals) / 4n, decimals);
  }

  public static f0_3(decimals: number): EDs {
    return EDs.new((EDs.base(decimals) * 3n) / 10n, decimals);
  }

  public static f0_33(decimals: number): EDs {
    return EDs.new(EDs.base(decimals) / 3n, decimals);
  }

  public static f0_4(decimals: number): EDs {
    return EDs.new((EDs.base(decimals) * 2n) / 5n, decimals);
  }

  public static f0_5(decimals: number): EDs {
    return EDs.new(EDs.base(decimals) / 2n, decimals);
  }

  public static f0_6(decimals: number): EDs {
    return EDs.new((EDs.base(decimals) * 3n) / 5n, decimals);
  }

  public static f0_67(decimals: number): EDs {
    return EDs.new((EDs.base(decimals) * 2n) / 3n, decimals);
  }

  public static f0_7(decimals: number): EDs {
    return EDs.new((EDs.base(decimals) * 7n) / 10n, decimals);
  }

  public static f0_75(decimals: number): EDs {
    return EDs.new((EDs.base(decimals) * 3n) / 4n, decimals);
  }

  public static f0_8(decimals: number): EDs {
    return EDs.new((EDs.base(decimals) * 4n) / 5n, decimals);
  }

  public static f0_9(decimals: number): EDs {
    return EDs.new((EDs.base(decimals) * 9n) / 10n, decimals);
  }

  public add(b: EDs): EDs {
    this.assertSameDecimals(b);

    return EDs.new(this.val + b.val, this.decimals);
  }

  public sub(b: EDs): EDs {
    this.assertSameDecimals(b);

    return EDs.new(this.val - b.val, this.decimals);
  }

  public mul(b: EDs): EDs {
    this.assertSameDecimals(b);

    return EDs.new((this.val * b.val) / EDs.base(this.decimals), this.decimals);
  }

  public mulNum(b: bigint): EDs {
    return EDs.new(this.val * b, this.decimals);
  }

  public div(b: EDs): EDs {
    return EDs.new((this.val * EDs.base(this.decimals)) / b.val, this.decimals);
  }

  public divNum(b: bigint): EDs {
    return EDs.new(this.val / b, this.decimals);
  }

  public toString() {
    return tokensToStr(this.val, this.decimals);
  }

  public static fromString(s: string, decimals: number): EDs {
    return EDs.new(strToTokens(s, decimals), decimals);
  }

  public toDecimals(decimals: number): EDs {
    if (decimals === this.decimals) {
      return EDs.new(this.val, this.decimals);
    }

    let val;

    if (decimals > this.decimals) {
      const b = EDs.base(decimals - this.decimals);
      val = this.val * b;
    } else {
      const b = EDs.base(this.decimals - decimals);
      val = this.val / b;
    }

    return EDs.new(val, decimals);
  }

  public toE8s(): E8s {
    this.assertSameDecimals(EDs.new(0n, 8));

    return E8s.new(this.val);
  }

  public toBool() {
    return this.val > 0n;
  }

  public isZero() {
    return this.val === 0n;
  }

  public toBigIntRaw() {
    return this.val;
  }

  public static fromBigIntBase(x: bigint, decimals: number) {
    return EDs.new(x * EDs.base(decimals), decimals);
  }

  public toBigIntBase() {
    return this.val / EDs.base(this.decimals);
  }

  public static fromPercentNum(p: number, decimals: number) {
    return EDs.new((BigInt(Math.floor(p)) * EDs.base(decimals)) / 100n, decimals);
  }

  public toPercentNum() {
    return Number((this.val * 100n) / EDs.base(this.decimals));
  }

  public toPercent() {
    return EDs.new(this.val * 100n, this.decimals);
  }
}
