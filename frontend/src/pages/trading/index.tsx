import { BalanceOf } from "@components/balance-of";
import { Bento } from "@components/bento";
import { BooleanInput } from "@components/boolean-input";
import { CandlestickChart } from "@components/candlestick-chart";
import { EIconKind, Icon } from "@components/icon";
import { Page } from "@components/page";
import { QtyInput } from "@components/qty-input";
import { Slider } from "@components/slider";
import { DEFAULT_TOKENS } from "@store/tokens";
import { useTrading } from "@store/trading";
import { COLORS } from "@utils/colors";
import { E8s, EDs } from "@utils/math";
import { eventHandler } from "@utils/security";
import { Result } from "@utils/types";
import { batch, createEffect, createSignal, Match, on, Show, Switch } from "solid-js";

export function TradingPage() {
  const { myBalances, fetchMyInfo, myTraderStats, priceInfo } = useTrading();

  const [mode, setMode] = createSignal<"long" | "short">("long");
  const [action, setAction] = createSignal<"buy" | "sell">("buy");

  const [realToPay, setRealToPay] = createSignal<Result<EDs, string>>(Result.Err(""));
  const [longToPay, setLongToPay] = createSignal<Result<EDs, string>>(Result.Err(""));
  const [shortToPay, setShortToPay] = createSignal<Result<EDs, string>>(Result.Err(""));

  const [realToGet, setRealToGet] = createSignal<EDs>(EDs.zero(8));
  const [longToGet, setLongToGet] = createSignal<EDs>(EDs.zero(8));
  const [shortToGet, setShortToGet] = createSignal<EDs>(EDs.zero(8));

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

  return (
    <Page>
      <div class="grid grid-cols-12 gap-6">
        <div class="col-span-3 flex flex-col gap-6">
          <Bento id={0} class="flex flex-col gap-4">
            <div class="flex justify-between items-center">
              <p class="text-gray-140 text-sm">
                <BalanceOf
                  balance={myBalances()?.real.inner().val}
                  tokenId={DEFAULT_TOKENS.burn}
                  onRefreshOverride={fetchMyInfo}
                />
              </p>
              <div class="flex gap-2 text-sm underline text-gray-140">
                <p class="cursor-pointer hover:text-white">Deposit</p>
                <p class="cursor-pointer hover:text-white">Withdraw</p>
              </div>
            </div>
          </Bento>
          <Bento id={0} class="flex flex-col gap-8">
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

            <div class="flex flex-col gap-6">
              <Switch>
                <Match when={action() === "buy"}>
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
                </Match>
                <Match when={action() === "sell"}>
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
                      validations={[{ max: myBalances()?.real.toDynamic() ?? EDs.zero(8) }]}
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
                </Match>
              </Switch>
            </div>
          </Bento>
        </div>

        <CandlestickChart class="col-span-9" kind={mode()} />
      </div>
    </Page>
  );
}
