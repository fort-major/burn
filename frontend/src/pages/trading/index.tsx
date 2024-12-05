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
import { DEFAULT_TOKENS } from "@store/tokens";
import { useTrading } from "@store/trading";
import { useTradingInvites } from "@store/trading-invites";
import { useWallet } from "@store/wallet";
import { COLORS } from "@utils/colors";
import { avatarSrcFromPrincipal, makeMyInviteLink } from "@utils/common";
import { bytesToHex, hexToBytes } from "@utils/encoding";
import { E8s, EDs } from "@utils/math";
import { eventHandler } from "@utils/security";
import { Result } from "@utils/types";
import {
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

export function TradingPage() {
  const {
    myBalances,
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
  const { pidBalance } = useWallet();
  const { isReadyToFetch, identity, disabled } = useAuth();
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
  });

  createEffect(
    on(isReadyToFetch, (ready) => {
      if (ready && Object.keys(traders).length === 0) {
        fetchTraders();
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

    const longPriceE8s = E8s.fromFloat(info.cur_long_price).toDynamic();
    const long = real.mul(longPriceE8s);

    const shortPriceE8s = E8s.fromFloat(info.cur_short_price).toDynamic();
    const short = real.mul(shortPriceE8s);

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
    const real = long.div(longPriceE8s);

    setRealToGet(real);
  };

  const recalcForSellShort = (short: EDs) => {
    const info = priceInfo();
    if (!info) return;

    const shortPriceE8s = E8s.fromFloat(info.cur_short_price).toDynamic();
    const real = short.div(shortPriceE8s);

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

  const topTraders = createMemo(() => {
    const allTraders = Object.entries(traders).map(([pidStr, stats]) => {
      const totalInvested = stats.total_long_bought.inner().val + stats.total_short_bought.inner().val;
      const totalReturned = stats.total_long_sold.inner().val + stats.total_short_sold.inner().val;

      const profit = totalReturned - totalInvested;

      const totalInvestedE8s = E8s.new(totalInvested);
      const profitPositive = profit > 0n;
      const profitE8s = E8s.new(profitPositive ? profit : profit * -1n);
      const roi = profitE8s.div(totalInvestedE8s);

      return {
        pid: Principal.fromText(pidStr),
        totalInvestedE8s,
        profitPositive,
        profitE8s,
        roi,
      };
    });

    // sorting in reverse
    allTraders.toSorted((a, b) => {
      if (!a.profitPositive && b.profitPositive) return 1;
      if (a.profitPositive && !b.profitPositive) return -1;

      if (a.profitE8s.lt(b.profitE8s)) {
        if (a.profitPositive) return 1;
        else return -1;
      }

      if (a.profitE8s.gt(b.profitE8s)) {
        if (a.profitPositive) return -1;
        else return 1;
      }

      if (a.totalInvestedE8s.lt(b.totalInvestedE8s)) return 1;
      if (a.totalInvestedE8s.gt(b.totalInvestedE8s)) return -1;

      return 0;
    });

    return allTraders.slice(0, 25);
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
        .then(() => navigate(ROOT.$.market.path));
    }
  });

  const inviteModal = () => {
    const mode = () => (isRegistered() || invite ? "loading" : "register");

    const title = () => {
      const m = mode();

      if (m === "loading") {
        return "Registering...";
      } else if (m === "register") {
        return "No Access";
      }

      return "Almost there...";
    };

    const registerBribe = eventHandler(() => {
      if (canRegisterWithBribe() && !disabled()) {
        registerWithBribe().then(() => fetchMyInfo());
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
                    balance={myBalances()?.real.inner().val}
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
                    {myBalances()?.long.toShortString({ belowOne: 2, belowThousand: 1, afterThousand: 2 })}
                  </span>{" "}
                  <span class="text-sm text-gray-140">ASH (LONG)</span>
                </p>
                <p>
                  <span class="font-semibold text-xl">
                    {myBalances()?.short.toShortString({ belowOne: 2, belowThousand: 1, afterThousand: 2 })}
                  </span>{" "}
                  <span class="text-sm text-gray-140">ASH (SHORT)</span>
                </p>
              </div>
            </Bento>

            <Bento id={0} class="flex-col gap-4">
              <p class="text-white font-semibold text-xl flex gap-4 items-center">Invite To Earn</p>
              <p class="text-md text-gray-140">
                Ash Market is a closed community. Only awesome people like you are welcome here. You earn{" "}
                <span class="font-semibold text-orange">0.15%</span> of all BURN deposits your invitees make.
              </p>

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
                        validations={[{ max: myBalances()?.real.toDynamic() ?? EDs.zero(8) }]}
                      />
                    </div>

                    <div class="flex flex-col gap-2">
                      <div class="flex items-center justify-between h-4">
                        <p class="font-semibold text-xs">You get</p>
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
                                ? myBalances()?.long.toDynamic() ?? EDs.zero(8)
                                : myBalances()?.short.toDynamic() ?? EDs.zero(8),
                          },
                        ]}
                      />
                    </div>

                    <div class="flex flex-col gap-2">
                      <div class="flex items-center justify-between h-4">
                        <p class="font-semibold text-xs">You get</p>
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

      <div class="flex flex-col gap-8 self-center w-full max-w-4xl">
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

            <div class="flex flex-col gap-2">
              <p class="font-semibold text-xs text-gray-140">To Be Deposited (0.3% fee)</p>
              <p>
                <span class="font-semibold text-lg">
                  {depositQty().isOk()
                    ? depositQty().unwrapOk().sub(EDs.new(10_000n, 8)).mul(EDs.new(9970_0000n, 8)).toString()
                    : "0.00"}
                </span>{" "}
                BURN
              </p>
            </div>

            <Btn text="Deposit" disabled={!canConfirmDeposit()} onClick={handleDeposit} bgColor={COLORS.orange} />
          </div>
        </Modal>
      </Show>

      <Show when={!isInvited()}>{inviteModal()}</Show>
    </Page>
  );
}
