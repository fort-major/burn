import { Order } from "@/declarations/trading/trading.did";
import { ROOT } from "@/routes";
import { Avatar } from "@components/avatar";
import { BalanceOf } from "@components/balance-of";
import { Bento } from "@components/bento";
import { BooleanInput } from "@components/boolean-input";
import { Btn } from "@components/btn";
import { CandlestickChart } from "@components/candlestick-chart";
import { Copyable } from "@components/copyable";
import { EIconKind, Icon } from "@components/icon";
import { Modal } from "@components/modal";
import { Page } from "@components/page";
import { QtyInput } from "@components/qty-input";
import { Spoiler } from "@components/spoiler";
import { delay, Principal } from "@fort-major/msq-shared";
import { areWeOnMobile } from "@pages/home";
import { useLocation, useNavigate, useSearchParams } from "@solidjs/router";
import { useAuth } from "@store/auth";
import { DEFAULT_TOKENS, useTokens } from "@store/tokens";
import { useTrading } from "@store/trading";
import { useTradingInvites } from "@store/trading-invites";
import { useWallet } from "@store/wallet";
import { optUnwrap } from "@utils/backend";
import { COLORS } from "@utils/colors";
import { avatarSrcFromPrincipal, makeMyInviteLink } from "@utils/common";
import { bytesToHex, hexToBytes, timestampToDMStr } from "@utils/encoding";
import { logInfo } from "@utils/error";
import { E8s, EDs } from "@utils/math";
import { eventHandler } from "@utils/security";
import { dateToDateTimeStr } from "@utils/time";
import { Result } from "@utils/types";
import {
  Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";

export interface ITraderStat {
  pid: Principal;
  totalInvestedE8s: E8s;
  profitE8s: E8s;
  profitPositive: boolean;
  roi: E8s;
}

export function TradingPage() {
  const {
    fetchMyInfo,
    myTraderStats,
    priceInfo,
    canOrder,
    order,
    canDeposit,
    deposit,
    canWithdraw,
    withdraw,
    orderHistory,
    fetchOrderHistory,
    traders,
    fetchTraders,
    isInvited,
    myOrders,
    myFeesEarned,
    referrers,
    fetchReferrers,
  } = useTrading();
  const {
    myInvite,
    isRegistered,
    canRegisterWithBribe,
    canRegisterWithInvite,
    registerWithBribe,
    fetchInviteOwner,
    registerWithInvite,
  } = useTradingInvites();
  const { pidBalance, pid } = useWallet();
  const { isReadyToFetch, isAuthorized, identity, disabled } = useAuth();
  const { icpSwapUsdExchangeRates } = useTokens();
  const navigate = useNavigate();
  const [{ invite }] = useSearchParams<{ invite: string }>();

  const [mode, setMode] = createSignal<"long" | "short">("long");
  const [action, setAction] = createSignal<"buy" | "sell">("buy");

  const [realToPay, setRealToPay] = createSignal<Result<EDs, string>>(Result.Err(""));
  const [longToPay, setLongToPay] = createSignal<Result<EDs, string>>(Result.Err(""));
  const [shortToPay, setShortToPay] = createSignal<Result<EDs, string>>(Result.Err(""));

  const [realToGet, setRealToGet] = createSignal<EDs>(EDs.zero(8));
  const [longToGet, setLongToGet] = createSignal<EDs>(EDs.zero(8));
  const [shortToGet, setShortToGet] = createSignal<EDs>(EDs.zero(8));

  const [depositModalVisible, setDepositModalVisible] = createSignal(false);
  const [depositQty, setDepositQty] = createSignal<Result<EDs, string>>(Result.Err(""));

  const [currentShownOrder, setCurrentShownOrder] = createSignal<Order>();
  const [isRunning, setIsRunning] = createSignal(true);

  onMount(async () => {
    while (isRunning()) {
      const keys = Object.keys(orderHistory);
      if (keys.length > 0) {
        const idx = Math.floor(Math.random() * keys.length);
        setCurrentShownOrder(orderHistory[keys[idx]]);
      }

      await delay(Math.floor(Math.random() * 3000));
    }
  });

  onMount(async () => {
    while (!isReadyToFetch()) {
      await delay(1000);
    }

    while (isRunning()) {
      await fetchOrderHistory();
      await delay(60000);
    }
  });

  onCleanup(() => {
    setIsRunning(false);
  });

  onMount(() => {
    if (isReadyToFetch() && Object.keys(traders).length === 0) {
      fetchTraders();
    }

    if (isReadyToFetch() && Object.keys(referrers).length === 0) {
      fetchReferrers();
    }
  });

  createEffect(
    on(isReadyToFetch, (ready) => {
      if (ready && Object.keys(traders).length === 0) {
        fetchTraders();
      }

      if (ready && Object.keys(referrers).length === 0) {
        fetchReferrers();
      }
    })
  );

  createEffect(
    on([mode, action], () => {
      setRealToPay(Result.Err<EDs, string>(""));
      setLongToPay(Result.Err<EDs, string>(""));
      setShortToPay(Result.Err<EDs, string>(""));

      setRealToGet(EDs.zero(8));
      setLongToGet(EDs.zero(8));
      setShortToGet(EDs.zero(8));
    })
  );

  const recalcForBuy = (real: EDs) => {
    const info = priceInfo();
    if (!info) return;

    real = real.mul(EDs.new(9970_0000n, 8));

    const longPriceE8s = E8s.fromFloat(info.cur_long_price).toDynamic();
    const long = real.div(longPriceE8s);

    const shortPriceE8s = E8s.fromFloat(info.cur_short_price).toDynamic();
    const short = real.div(shortPriceE8s);

    batch(() => {
      setLongToGet(long);
      setShortToGet(short);
    });
  };

  createEffect(
    on(realToPay, (rtp) => {
      if (rtp.isErr()) return;

      recalcForBuy(rtp.unwrapOk());
    })
  );

  const recalcForSellLong = (long: EDs) => {
    const info = priceInfo();
    if (!info) return;

    const longPriceE8s = E8s.fromFloat(info.cur_long_price).toDynamic();
    const real = long.mul(longPriceE8s).mul(EDs.new(9970_0000n, 8));

    setRealToGet(real);
  };

  const recalcForSellShort = (short: EDs) => {
    const info = priceInfo();
    if (!info) return;

    const shortPriceE8s = E8s.fromFloat(info.cur_short_price).toDynamic();
    const real = short.mul(shortPriceE8s).mul(EDs.new(9970_0000n, 8));

    setRealToGet(real);
  };

  createEffect(
    on(longToPay, (ltp) => {
      if (ltp.isErr()) return;

      recalcForSellLong(ltp.unwrapOk());
    })
  );

  createEffect(
    on(shortToPay, (stp) => {
      if (stp.isErr()) return;

      recalcForSellShort(stp.unwrapOk());
    })
  );

  const canClickDeposit = () => {
    const b = pidBalance(DEFAULT_TOKENS.burn);
    if (!b) return false;

    return b > 10_000n;
  };

  const handleDepositClick = eventHandler(() => {
    if (!canClickDeposit() || disabled()) return;

    setDepositModalVisible(true);
    setDepositQty(Result.Err<EDs, string>(""));
  });

  const handleWithdrawClick = eventHandler(() => {
    if (!canWithdraw() || disabled()) return;

    withdraw();
  });

  const canConfirmDeposit = () => {
    if (depositQty().isErr()) return false;
    const qty = depositQty().unwrapOk();

    return canDeposit(qty.toE8s());
  };

  const handleDeposit = async () => {
    await deposit(depositQty().unwrapOk().toE8s());
    setDepositModalVisible(false);
  };

  const canBuyLong = () => {
    const b = realToPay();
    if (b.isErr()) return false;

    return canOrder(false, false, b.unwrapOk().toE8s());
  };

  const buyLong = async () => {
    const b = realToPay().unwrapOk();

    await order(false, false, b.toE8s());

    batch(() => {
      setRealToPay(Result.Err<EDs, string>(""));
      setLongToGet(EDs.new(0n, 8));
    });
  };

  const canBuyShort = () => {
    const b = realToPay();
    if (b.isErr()) return false;

    return canOrder(true, false, b.unwrapOk().toE8s());
  };

  const buyShort = async () => {
    const b = realToPay().unwrapOk();

    await order(true, false, b.toE8s());

    batch(() => {
      setRealToPay(Result.Err<EDs, string>(""));
      setShortToGet(EDs.new(0n, 8));
    });
  };

  const canSellLong = () => {
    const b = longToPay();
    if (b.isErr()) return false;

    return canOrder(false, true, b.unwrapOk().toE8s());
  };

  const sellLong = async () => {
    const b = longToPay().unwrapOk();

    await order(false, true, b.toE8s());

    batch(() => {
      setLongToPay(Result.Err<EDs, string>(""));
      setRealToGet(EDs.new(0n, 8));
    });
  };

  const canSellShort = () => {
    const b = shortToPay();
    if (b.isErr()) return false;

    return canOrder(true, true, b.unwrapOk().toE8s());
  };

  const sellShort = async () => {
    const b = shortToPay().unwrapOk();

    await order(true, true, b.toE8s());

    batch(() => {
      setShortToPay(Result.Err<EDs, string>(""));
      setRealToGet(EDs.new(0n, 8));
    });
  };

  const myStats: Accessor<ITraderStat | undefined> = () => {
    const s = myTraderStats();
    if (!s) return undefined;

    const p = priceInfo();
    if (!p) return undefined;

    const totalInvested = s.total_long_bought.inner().val + s.total_short_bought.inner().val;
    let totalReturned = s.total_long_sold.inner().val + s.total_short_sold.inner().val;

    if (!s.cur_long_balance.isZero()) {
      const longPriceE8s = E8s.fromFloat(p.cur_long_price);
      totalReturned += s.cur_long_balance.mul(longPriceE8s).mul(E8s.new(9970_0000n)).inner().val;
    }

    if (!s.cur_short_balance.isZero()) {
      const shortPriceE8s = E8s.fromFloat(p.cur_short_price);
      totalReturned += s.cur_short_balance.mul(shortPriceE8s).mul(E8s.new(9970_0000n)).inner().val;
    }

    const profit = totalReturned - totalInvested;

    const totalInvestedE8s = E8s.new(totalInvested);
    const profitPositive = profit > 0n;
    const profitE8s = E8s.new(profitPositive ? profit : profit * -1n);
    const roi = totalInvestedE8s.isZero() ? E8s.zero() : profitE8s.div(totalInvestedE8s);

    return {
      pid: pid()!,
      totalInvestedE8s,
      profitPositive,
      profitE8s,
      roi,
    };
  };

  const topTraders: Accessor<ITraderStat[]> = createMemo(() => {
    const p = priceInfo();
    if (!p) return [];

    const allTraders = Object.entries(traders)
      .map(([pidStr, stats]) => {
        const totalInvested = stats.total_long_bought.inner().val + stats.total_short_bought.inner().val;
        let totalReturned = stats.total_long_sold.inner().val + stats.total_short_sold.inner().val;

        if (!stats.cur_long_balance.isZero()) {
          const longPriceE8s = E8s.fromFloat(p.cur_long_price);
          totalReturned += stats.cur_long_balance.mul(longPriceE8s).mul(E8s.new(9970_0000n)).inner().val;
        }

        if (!stats.cur_short_balance.isZero()) {
          const shortPriceE8s = E8s.fromFloat(p.cur_short_price);
          totalReturned += stats.cur_short_balance.mul(shortPriceE8s).mul(E8s.new(9970_0000n)).inner().val;
        }

        const profit = totalReturned - totalInvested;

        const totalInvestedE8s = E8s.new(totalInvested);
        const profitPositive = profit > 0n;
        const profitE8s = E8s.new(profitPositive ? profit : profit * -1n);
        const roi = totalInvestedE8s.isZero() ? E8s.zero() : profitE8s.div(totalInvestedE8s);

        return {
          pid: Principal.fromText(pidStr),
          totalInvestedE8s,
          profitPositive,
          profitE8s,
          roi,
        };
      })
      .filter((it) => it.profitPositive && it.totalInvestedE8s.ge(E8s.new(100_0000_0000n)));

    // sorting in reverse
    allTraders.sort((a, b) => {
      if (!a.profitPositive && b.profitPositive) return 1;
      if (a.profitPositive && !b.profitPositive) return -1;

      if (a.roi.lt(b.roi)) {
        if (a.profitPositive) return 1;
        else return -1;
      }

      if (a.roi.gt(b.roi)) {
        if (a.profitPositive) return -1;
        else return 1;
      }

      if (a.totalInvestedE8s.lt(b.totalInvestedE8s)) return 1;
      if (a.totalInvestedE8s.gt(b.totalInvestedE8s)) return -1;

      return 0;
    });

    return allTraders.slice(0, 25);
  });

  const topReferrers = createMemo(() => {
    const burnUsdExchangeRate = icpSwapUsdExchangeRates[DEFAULT_TOKENS.burn.toText()];
    if (!burnUsdExchangeRate) return [];

    return Object.entries(referrers)
      .sort((a, b) => {
        if (a[1].lt(b[1])) return 1;
        if (a[1].gt(b[1])) return -1;

        return 0;
      })
      .slice(0, 25)
      .map(([pid, val]) => {
        return {
          pid: Principal.fromText(pid),
          val,
          valUsd: val.mul(burnUsdExchangeRate),
        };
      });
  });

  const curOrder = () => {
    const o = currentShownOrder();
    if (!o) return undefined;

    return (
      <div
        class="flex gap-2 items-center justify-between px-6 py-2 rounded-xl text-sm font-semibold"
        classList={{ "bg-green": !o.sell, "bg-errorRed": o.sell }}
      >
        <Avatar url={avatarSrcFromPrincipal(o.pid)} size="sm" borderColor={COLORS.gray[140]} />

        <Show when={!areWeOnMobile()}>
          <Copyable text={o.pid.toText()} ellipsis ellipsisSymbols={12} />
        </Show>

        <p>
          {o.sell ? "SELL" : "BUY"} ({o.short ? "SHORT" : "LONG"})
        </p>

        <div class="flex gap-1 items-baseline text-sm">
          <p>
            for <span>{E8s.new(o.base_qty).toShortString({ belowOne: 2, belowThousand: 1, afterThousand: 2 })}</span>{" "}
            BURN
          </p>
        </div>
      </div>
    );
  };

  onMount(async () => {
    while (!isReadyToFetch()) {
      await delay(100);
    }

    if (invite) fetchInviteOwner(hexToBytes(invite));
  });

  createEffect(() => {
    if (isRegistered() === false && isInvited() === false && invite && canRegisterWithInvite(invite)) {
      registerWithInvite(invite)
        .then(() => fetchMyInfo())
        .then(() => {
          navigate(ROOT.$.market.path);
          logInfo("Registered!");
        });
    }
  });

  const totalLockedPercent = createMemo(() => {
    const p = priceInfo();
    if (!p) return undefined;

    const totalShort = optUnwrap(p.total_short);
    if (!totalShort) return undefined;

    const totalLong = optUnwrap(p.total_long);
    if (!totalLong) return undefined;

    const totalShortE8s = E8s.new(totalShort).mul(E8s.fromFloat(p.cur_short_price));
    const totalLongE8s = E8s.new(totalLong).mul(E8s.fromFloat(p.cur_long_price));

    const total = totalShortE8s.add(totalLongE8s);

    const s = totalShortE8s.div(total).toPercentNum();
    const l = totalLongE8s.div(total).toPercentNum();

    return { l, s };
  });

  const inviteModal = () => {
    const mode = () => (isRegistered() || invite ? "loading" : "register");

    const title = () => {
      const m = mode();

      if (m === "loading") {
        return "Registering your trading licence...";
      } else if (m === "register") {
        return "No Access";
      }

      return "Almost there...";
    };

    const registerBribe = eventHandler(() => {
      if (canRegisterWithBribe() && !disabled()) {
        registerWithBribe()
          .then(() => fetchMyInfo())
          .then(() => logInfo("Registered!"));
      }
    });

    return (
      <Modal title={title()} onClose={() => navigate(ROOT.path)}>
        <div class="flex flex-col">
          <Switch>
            <Match when={mode() === "register"}>
              <div class="flex flex-grow items-center justify-center h-32 max-w-72 text-center self-center">
                <p class="italic text-xl">The Ash Market opens its gates only to those beckoned by an invitation.</p>
              </div>

              <Spoiler class="justify-self-end" header="">
                <div class="flex items-center justify-end gap-4">
                  <p class="text-gray-140">Bribe the guard</p>

                  <div
                    class="px-4 py-2 rounded-full flex items-center gap-1"
                    classList={{
                      ["bg-orange cursor-pointer"]: !disabled() && canRegisterWithBribe(),
                      ["bg-gray-140"]: disabled() || !canRegisterWithBribe(),
                    }}
                    onClick={registerBribe}
                  >
                    <p class="font-semibold text-md text-white">1000</p>
                    <img src="/LogoWhite.svg" class="w-4 h-4 rounded-full" />
                  </div>
                </div>
              </Spoiler>
            </Match>
            <Match when={mode() === "loading"}>
              <div class="flex flex-grow items-center justify-center h-32 max-w-72 text-center self-center">
                <Switch>
                  <Match when={isAuthorized()}>
                    <svg xmlns="http://www.w3.org/2000/svg" width={50} height={50} viewBox="0 0 200 200">
                      <path
                        fill={COLORS.orange}
                        stroke={COLORS.orange}
                        stroke-width="15"
                        transform-origin="center"
                        d="m148 84.7 13.8-8-10-17.3-13.8 8a50 50 0 0 0-27.4-15.9v-16h-20v16A50 50 0 0 0 63 67.4l-13.8-8-10 17.3 13.8 8a50 50 0 0 0 0 31.7l-13.8 8 10 17.3 13.8-8a50 50 0 0 0 27.5 15.9v16h20v-16a50 50 0 0 0 27.4-15.9l13.8 8 10-17.3-13.8-8a50 50 0 0 0 0-31.7Zm-47.5 50.8a35 35 0 1 1 0-70 35 35 0 0 1 0 70Z"
                      >
                        <animateTransform
                          type="rotate"
                          attributeName="transform"
                          calcMode="spline"
                          dur="2"
                          values="0;120"
                          keyTimes="0;1"
                          keySplines="0 0 1 1"
                          repeatCount="indefinite"
                        ></animateTransform>
                      </path>
                    </svg>
                  </Match>
                  <Match when={!isAuthorized()}>
                    <p class="italic text-xl">Log in and try following the link again to continue.</p>
                  </Match>
                </Switch>
              </div>
            </Match>
          </Switch>
        </div>
      </Modal>
    );
  };

  return (
    <Page slim>
      <div class="flex flex-col gap-10">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p class="font-semibold text-xl text-gray-140">Imaginary price, real profits</p>
          <div class="flex flex-col">
            <Show
              when={currentShownOrder()}
              fallback={<p class="text-sm text-center text-gray-140">Loading trade history...</p>}
            >
              {curOrder()}
            </Show>
          </div>
        </div>

        <CandlestickChart kind={mode()} class="h-[500px]" />

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div class="flex flex-col gap-6 order-last sm:order-first">
            <Bento id={0} class="flex flex-col gap-4">
              <div class="flex justify-between items-center">
                <p class="text-gray-140 text-sm">
                  <BalanceOf
                    balance={myTraderStats()?.cur_real_balance.inner().val}
                    tokenId={DEFAULT_TOKENS.burn}
                    onRefreshOverride={fetchMyInfo}
                  />
                </p>
                <div class="flex gap-2 text-sm">
                  <p
                    class="underline text-gray-140"
                    classList={{ "text-orange cursor-pointer decoration-orange": !disabled() && canClickDeposit() }}
                    onClick={handleDepositClick}
                  >
                    Deposit
                  </p>
                  <p
                    class="underline text-gray-140"
                    classList={{ "text-orange cursor-pointer decoration-orange": !disabled() && canWithdraw() }}
                    onClick={handleWithdrawClick}
                  >
                    Withdraw
                  </p>
                </div>
              </div>
              <div class="flex items-center justify-between gap-4">
                <p>
                  <span class="font-semibold text-xl">
                    {myTraderStats()?.cur_long_balance.toShortString({
                      belowOne: 2,
                      belowThousand: 1,
                      afterThousand: 2,
                    })}
                  </span>{" "}
                  <span class="text-sm text-gray-140">ASH (LONG)</span>
                </p>
                <p>
                  <span class="font-semibold text-xl">
                    {myTraderStats()?.cur_short_balance.toShortString({
                      belowOne: 2,
                      belowThousand: 1,
                      afterThousand: 2,
                    })}
                  </span>{" "}
                  <span class="text-sm text-gray-140">ASH (SHORT)</span>
                </p>
              </div>
            </Bento>

            <Bento id={0} class="flex-col gap-4">
              <p class="text-white font-semibold text-xl flex gap-4 items-center">Invite To Earn</p>
              <p class="text-md text-gray-140">
                Ash Market is a closed community. Only awesome people like you are welcome here. You earn{" "}
                <span class="font-semibold text-orange">0.24%</span> of all swaps your invitees make.
              </p>

              <div class="flex flex-row gap-4 items-baseline justify-between">
                <p class="text-4xl font-semibold flex items-baseline gap-2">
                  {myFeesEarned().toShortString({ belowOne: 4, belowThousand: 2, afterThousand: 2 })}
                  <span class="text-gray-140 text-md">BURN</span>
                </p>
                <p class="text-xs font-semibold">Total Earned</p>
              </div>

              <div class="flex flex-col gap-4">
                <p class="text-xs font-semibold">Copy your unique invite link and pass it to the invitee</p>
                <Show when={myInvite()}>
                  <Copyable text={makeMyInviteLink(myInvite()!).toString()} ellipsis ellipsisSymbols={40} />
                </Show>
              </div>
            </Bento>
          </div>

          <Bento id={1} class="flex flex-col gap-8">
            <div class="grid grid-cols-2 gap-2 text-center font-bold text-lg text-gray-140 cursor-pointer border-b pb-2 border-gray-115">
              <p
                class="hover:text-white flex gap-1 items-center justify-center"
                classList={{ "text-white": action() === "buy" }}
                onClick={eventHandler(() => {
                  setAction("buy");
                })}
              >
                BUY
              </p>
              <p
                class="hover:text-white flex gap-1 items-center justify-center"
                classList={{ "text-white": action() === "sell" }}
                onClick={eventHandler(() => {
                  setAction("sell");
                })}
              >
                SELL
              </p>
            </div>

            <div class="flex flex-col gap-6 flex-grow justify-between">
              <Switch>
                <Match when={action() === "buy"}>
                  <div class="flex flex-col gap-6">
                    <div class="flex flex-col gap-2">
                      <p class="font-semibold text-xs">You send</p>
                      <QtyInput
                        value={realToPay()}
                        onChange={setRealToPay}
                        fee={EDs.zero(8)}
                        decimals={8}
                        symbol="BURN"
                        validations={[{ max: myTraderStats()?.cur_real_balance.toDynamic() ?? EDs.zero(8) }]}
                      />
                    </div>

                    <div class="flex flex-col gap-2">
                      <div class="flex items-center justify-between h-4">
                        <p class="font-semibold text-xs">You get (-0.3%)</p>
                        <BooleanInput
                          value={mode() === "long"}
                          labelOn="Long"
                          labelOff="Short"
                          onChange={() => setMode((m) => (m === "long" ? "short" : "long"))}
                        />
                      </div>
                      <div class="rounded-md bg-gray-110 p-2 flex justify-between">
                        <Switch>
                          <Match when={mode() === "long"}>
                            <span>{longToGet().toString()}</span> <span class="text-gray-140">ASH (LONG)</span>
                          </Match>
                          <Match when={mode() === "short"}>
                            <span>{shortToGet().toString()}</span> <span class="text-gray-140">ASH (SHORT)</span>
                          </Match>
                        </Switch>
                      </div>
                    </div>
                  </div>

                  <Btn
                    text="Buy"
                    bgColor={COLORS.green}
                    class="font-semibold"
                    disabled={mode() === "long" ? !canBuyLong() : !canBuyShort()}
                    onClick={mode() === "long" ? buyLong : buyShort}
                  />
                </Match>
                <Match when={action() === "sell"}>
                  <div class="flex flex-col gap-6">
                    <div class="flex flex-col gap-2">
                      <div class="flex items-center justify-between h-4">
                        <p class="font-semibold text-xs">You send</p>
                        <BooleanInput
                          value={mode() === "long"}
                          labelOn="Long"
                          labelOff="Short"
                          onChange={() => setMode((m) => (m === "long" ? "short" : "long"))}
                        />
                      </div>
                      <QtyInput
                        value={mode() === "long" ? longToPay() : shortToPay()}
                        onChange={mode() === "long" ? setLongToPay : setShortToPay}
                        fee={EDs.zero(8)}
                        decimals={8}
                        symbol={mode() === "long" ? "ASH (LONG)" : "ASH (SHORT)"}
                        validations={[
                          {
                            max:
                              mode() === "long"
                                ? myTraderStats()?.cur_long_balance.toDynamic() ?? EDs.zero(8)
                                : myTraderStats()?.cur_short_balance.toDynamic() ?? EDs.zero(8),
                          },
                        ]}
                      />
                    </div>

                    <div class="flex flex-col gap-2">
                      <div class="flex items-center justify-between h-4">
                        <p class="font-semibold text-xs">You get (-0.3%)</p>
                      </div>
                      <div class="rounded-md bg-gray-110 p-2 flex justify-between">
                        <span>{realToGet().toString()}</span> <span class="text-gray-140">BURN</span>
                      </div>
                    </div>
                  </div>

                  <Btn
                    text="Sell"
                    bgColor={COLORS.errorRed}
                    class="font-semibold"
                    disabled={mode() === "long" ? !canSellLong() : !canSellShort()}
                    onClick={mode() === "long" ? sellLong : sellShort}
                  />
                </Match>
              </Switch>
            </div>
          </Bento>
        </div>
      </div>

      <div class="flex flex-col gap-12 self-center w-full max-w-4xl">
        <Show when={totalLockedPercent()}>
          <div class="flex flex-col gap-6">
            <p class="text-white font-semibold text-4xl flex gap-4 items-center">Total Funds Locked</p>
            <div class="relative flex h-10 rounded-xl overflow-hidden">
              <div
                class="h-full absolute left-0 top-0 bottom-0 bg-green flex items-center justify-center min-w-1"
                style={{ width: `${totalLockedPercent()!.l}%` }}
              >
                <p class="text-white font-semibold text-md">
                  <Show when={totalLockedPercent()!.l > 10} fallback=" ">
                    {E8s.new(optUnwrap(priceInfo()!.total_long)!).mul(E8s.fromFloat(priceInfo()!.cur_long_price)).toShortString({
                      belowOne: 2,
                      belowThousand: 1,
                      afterThousand: 2,
                    })}{" "}
                    BURN
                  </Show>
                </p>
              </div>

              <div
                class="h-full absolute right-0 top-0 bottom-0 bg-errorRed flex items-center justify-center min-w-1"
                style={{ width: `${totalLockedPercent()!.s}%` }}
              >
                <p class="text-white font-semibold text-md">
                  <Show when={totalLockedPercent()!.s > 10} fallback=" ">
                    {E8s.new(optUnwrap(priceInfo()!.total_short)!).mul(E8s.fromFloat(priceInfo()!.cur_short_price)).toShortString({
                      belowOne: 2,
                      belowThousand: 1,
                      afterThousand: 2,
                    })}{" "}
                    BURN
                  </Show>
                </p>
              </div>
            </div>
          </div>
        </Show>

        <Show when={myStats()}>
          <div class="flex flex-col gap-6">
            <p class="text-white font-semibold text-4xl flex gap-4 items-center">Your Stats</p>

            <div class="flex flex-row gap-8 sm:gap-12 flex-wrap">
              <div class="flex gap-2 items-baseline">
                <p class="font-semibold text-3xl">
                  {myStats()!.totalInvestedE8s.toShortString({ belowOne: 2, belowThousand: 1, afterThousand: 2 })}
                </p>
                <p>Total Volume</p>
              </div>

              <div class="flex gap-2 items-baseline">
                <p
                  class="col-span-1 font-semibold text-3xl"
                  classList={{ "text-green": myStats()!.profitPositive, "text-errorRed": !myStats()!.profitPositive }}
                >
                  {myStats()!.profitE8s.toShortString({ belowOne: 2, belowThousand: 1, afterThousand: 2 })}
                </p>
                <p>Total Profit</p>
              </div>

              <div class="flex gap-2 items-baseline">
                <p
                  class="col-span-1 font-semibold text-3xl"
                  classList={{ "text-green": myStats()!.profitPositive, "text-errorRed": !myStats()!.profitPositive }}
                >
                  {myStats()!.roi.toPercent().toShortString({ belowOne: 3, belowThousand: 1, afterThousand: 1 })}%
                </p>
                <p>ROI</p>
              </div>
            </div>

            <Show when={myOrders() && myOrders()!.length > 0}>
              <div class="flex flex-col gap-4">
                <div class="mb-2 grid grid-cols-5 sm:grid-cols-4 items-start md:items-center gap-3 text-xs font-semibold text-gray-140">
                  <p class="col-span-2 sm:col-span-1">Time</p>
                  <p class="col-span-1">Kind</p>
                  <p class="col-span-1">Option</p>
                  <p class="col-span-1">Amount BURN</p>
                </div>

                <div class="flex flex-col gap-2">
                  <For
                    each={myOrders()?.slice(0, 100)}
                    fallback={<p class="text-sm text-gray-140">Nothing here yet :(</p>}
                  >
                    {(order) => {
                      return (
                        <div class="grid p-2 grid-cols-5 sm:grid-cols-4 items-center gap-3 odd:bg-gray-105 even:bg-black relative">
                          <p class="col-span-2 sm:col-span-1 font-semibold text-xs sm:text-md text-gray-140">
                            {dateToDateTimeStr(new Date(Number(order.timestmap / 1000_000n)))}
                          </p>
                          <p
                            class="col-span-1 font-semibold text-md"
                            classList={{ "text-green": !order.sell, "text-errorRed": order.sell }}
                          >
                            {order.sell ? "Sell" : "Buy"}
                          </p>
                          <p class="col-span-1 font-semibold text-xs sm:text-md text-gray-140">
                            {order.short ? "ASH (SHORT)" : "ASH (LONG)"}
                          </p>
                          <p class="col-span-1 font-semibold text-md text-white">
                            {E8s.new(order.base_qty).toShortString({ belowOne: 2, belowThousand: 1, afterThousand: 2 })}
                          </p>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={topTraders().length > 0}>
          <div class="flex flex-col gap-6">
            <p class="text-white font-semibold text-4xl flex gap-4 items-center">Best Traders</p>
            <div class="flex flex-col gap-4">
              <div class="mb-2 grid grid-cols-4 md:grid-cols-5 items-start md:items-center gap-3 text-xs font-semibold text-gray-140">
                <p class="col-span-1 text-right"></p>
                <p class="col-span-1 text-right hidden md:block">PID</p>
                <p class="col-span-1 text-right">Total Volume</p>
                <p class="col-span-1 text-right">Total Profit</p>
                <p class="col-span-1 text-right">ROI %</p>
              </div>

              <div class="flex flex-col gap-2">
                <For each={topTraders()} fallback={<p class="text-sm text-gray-140">Nothing here yet :(</p>}>
                  {(trader, idx) => {
                    return (
                      <div class="grid p-2 grid-cols-4 md:grid-cols-5 items-center gap-3 odd:bg-gray-105 even:bg-black relative">
                        <div class="flex items-center gap-1 col-span-1">
                          <p
                            class="text-xs text-gray-140 font-semibold min-w-7"
                            classList={{ ["text-white"]: identity()?.getPrincipal().compareTo(trader.pid) === "eq" }}
                          >
                            {idx() + 1}
                          </p>
                          <Avatar
                            url={avatarSrcFromPrincipal(trader.pid)}
                            size="sm"
                            borderColor={
                              identity()?.getPrincipal().compareTo(trader.pid) === "eq"
                                ? COLORS.chartreuse
                                : COLORS.gray[140]
                            }
                          />
                        </div>
                        <Copyable class="col-span-1 hidden md:flex" text={trader.pid.toText()} ellipsis />
                        <p class="col-span-1 font-semibold text-md text-right text-gray-140">
                          {trader.totalInvestedE8s.toShortString({ belowOne: 2, belowThousand: 1, afterThousand: 2 })}
                        </p>
                        <p
                          class="col-span-1 font-semibold text-md text-right"
                          classList={{ "text-green": trader.profitPositive, "text-errorRed": !trader.profitPositive }}
                        >
                          {trader.profitE8s.toShortString({ belowOne: 2, belowThousand: 1, afterThousand: 2 })}
                        </p>
                        <p
                          class="col-span-1 font-semibold text-md text-right"
                          classList={{ "text-green": trader.profitPositive, "text-errorRed": !trader.profitPositive }}
                        >
                          {trader.roi.toPercent().toShortString({ belowOne: 3, belowThousand: 1, afterThousand: 1 })}%
                        </p>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          </div>
        </Show>

        <Show when={topReferrers().length > 0}>
          <div class="flex flex-col gap-6">
            <div class="flex flex-col gap-2">
              <p class="text-white font-semibold text-4xl flex gap-4 items-center">Best Referrers</p>
              <p class="text-gray-140 text-xs">
                These guys shared their invite link with other people and earn fees doing nothing
              </p>
            </div>
            <div class="flex flex-col gap-4">
              <div class="mb-2 grid grid-cols-3 md:grid-cols-4 items-start md:items-center gap-3 text-xs font-semibold text-gray-140">
                <p class="col-span-1 text-right"></p>
                <p class="col-span-1 text-right hidden md:block">PID</p>
                <p class="col-span-1 text-right">Total Profit (BURN)</p>
                <p class="col-span-1 text-right">Total Profit (USD)</p>
              </div>

              <div class="flex flex-col gap-2">
                <For each={topReferrers()} fallback={<p class="text-sm text-gray-140">Nothing here yet :(</p>}>
                  {(referrer, idx) => {
                    return (
                      <div class="grid p-2 grid-cols-3 md:grid-cols-4 items-center gap-3 odd:bg-gray-105 even:bg-black relative">
                        <div class="flex items-center gap-1 col-span-1">
                          <p
                            class="text-xs text-gray-140 font-semibold min-w-7"
                            classList={{
                              ["text-white"]: identity()?.getPrincipal().compareTo(referrer.pid) === "eq",
                            }}
                          >
                            {idx() + 1}
                          </p>
                          <Avatar
                            url={avatarSrcFromPrincipal(referrer.pid)}
                            size="sm"
                            borderColor={
                              identity()?.getPrincipal().compareTo(referrer.pid) === "eq"
                                ? COLORS.chartreuse
                                : COLORS.gray[140]
                            }
                          />
                        </div>
                        <Copyable
                          class="col-span-1 hidden md:flex"
                          text={referrer.pid.toText()}
                          ellipsis
                          ellipsisSymbols={15}
                        />
                        <p class="col-span-1 font-semibold text-md text-right text-gray-140">
                          {referrer.val.toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 2 })}
                        </p>
                        <p class="col-span-1 font-semibold text-md text-right text-gray-140">
                          ${referrer.valUsd.toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 2 })}
                        </p>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          </div>
        </Show>
      </div>

      <Show when={depositModalVisible()}>
        <Modal title="Deposit BURN" onClose={() => setDepositModalVisible(false)}>
          <div class="flex flex-col gap-6">
            <div class="flex flex-col gap-2">
              <p class="font-semibold text-xs text-gray-140">Amount</p>
              <QtyInput
                decimals={8}
                symbol="BURN"
                value={depositQty()}
                onChange={setDepositQty}
                fee={EDs.new(10_000n, 8)}
                validations={
                  pidBalance(DEFAULT_TOKENS.burn) ? [{ max: EDs.new(pidBalance(DEFAULT_TOKENS.burn)!, 8) }] : undefined
                }
              />
            </div>

            <Btn text="Deposit" disabled={!canConfirmDeposit()} onClick={handleDeposit} bgColor={COLORS.orange} />
          </div>
        </Modal>
      </Show>

      <Show when={!isInvited()}>{inviteModal()}</Show>
    </Page>
  );
}
