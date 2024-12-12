import { Candle } from "@/declarations/trading/trading.did";
import { Bento } from "@components/bento";
import { EIconKind, Icon } from "@components/icon";
import { useAuth } from "@store/auth";
import { useTrading } from "@store/trading";
import { useWallet } from "@store/wallet";
import { COLORS } from "@utils/colors";
import { eventHandler } from "@utils/security";
import { IClass, ONE_DAY_NS, ONE_HOUR_NS, ONE_WEEK_NS } from "@utils/types";
import { ApexOptions } from "apexcharts";
import { SolidApexCharts } from "solid-apexcharts";
import { Accessor, createEffect, createMemo, createSignal, on, onMount, Show } from "solid-js";

export interface ICandlestickChart extends IClass {
  kind: "short" | "long";
}

export function CandlestickChart(props: ICandlestickChart) {
  const { isReadyToFetch } = useAuth();
  const {
    longPriceHistory1d,
    longPriceHistory4h,
    shortPriceHistory1d,
    shortPriceHistory4h,
    fetchPriceHistory,
    priceInfo,
    priceInfoCounter1d,
    priceInfoCounter4h,
  } = useTrading();
  const [timing, setTiming] = createSignal<"1d" | "4h">("4h");

  const [activeCurrentCandle, setActiveCurrentCandle] = createSignal<Candle | undefined>(
    props.kind === "long" ? priceInfo()?.cur_1d_long_candle : priceInfo()?.cur_1d_short_candle
  );
  const [activeHistory, setActiveHistory] = createSignal<Candle[]>(
    props.kind === "long" ? longPriceHistory1d : shortPriceHistory1d
  );

  const kind = () => props.kind;

  createEffect(
    on([activeHistory, isReadyToFetch], ([candles, ready]) => {
      if (candles.length === 0 && ready) {
        fetchPriceHistory(kind() === "short", timing());
      }
    })
  );

  const setActivePriceHistory = (k: "long" | "short", t: "1d" | "4h") => {
    if (k === "long" && t === "1d") setActiveHistory(longPriceHistory1d);
    if (k === "long" && t === "4h") setActiveHistory(longPriceHistory4h);
    if (k === "short" && t === "1d") setActiveHistory(shortPriceHistory1d);
    if (k === "short" && t === "4h") setActiveHistory(shortPriceHistory4h);
  };

  onMount(() => {
    setActivePriceHistory(kind(), timing());
  });

  createEffect(
    on([kind, timing], ([k, t]) => {
      setActivePriceHistory(k, t);
    })
  );

  createEffect(
    on(priceInfoCounter1d, () => {
      if (isReadyToFetch()) {
        fetchPriceHistory(true, "1d");
        fetchPriceHistory(false, "1d");
      }
    })
  );

  createEffect(
    on(priceInfoCounter4h, () => {
      if (isReadyToFetch()) {
        fetchPriceHistory(true, "4h");
        fetchPriceHistory(false, "4h");
      }
    })
  );

  createEffect(
    on([priceInfo, kind, timing], ([info, k, t]) => {
      if (!info) return;

      if (k === "long" && t === "1d") setActiveCurrentCandle(info.cur_1d_long_candle);
      if (k === "long" && t === "4h") setActiveCurrentCandle(info.cur_4h_long_candle);
      if (k === "short" && t === "1d") setActiveCurrentCandle(info.cur_1d_short_candle);
      if (k === "short" && t === "4h") setActiveCurrentCandle(info.cur_4h_short_candle);
    })
  );

  const series = createMemo(() => {
    let data = activeHistory().map((it) => ({
      x: new Date(Number(it.open_ts / 1000_000n)),
      y: [it.open, it.high, it.low, it.close],
    }));

    const cur = activeCurrentCandle();
    if (cur) {
      data.push({
        x: new Date(Number(cur.open_ts / 1000_000n)),
        y: [cur.open, cur.high, cur.low, cur.close],
      });
    }

    const prefix: { x: Date; y: [number, number, number, number] }[] = [];

    /* if (data.length < 20 && data.length > 0) {
      const firstTs = data[0].x.getTime();
      const difMs = Number(timing() === "1d" ? ONE_DAY_NS / 1000_000n : ONE_HOUR_NS / 250_000n);
      for (let i = 0; i < 20 - data.length; i++) {
        prefix.push({
          x: new Date(firstTs - difMs * (i + 1)),
          y: [1.0, 1.0, 1.0, 1.0],
        });
      }
 */
    data = [...prefix.reverse(), ...data];

    return [{ data, name: "candles" }];
  });

  const [options] = createSignal<ApexOptions>({
    tooltip: {
      style: {
        fontFamily: "DM Sans",
      },
      theme: "",
      custom: () => "",
      cssClass: "text-gray-140",
    },
    chart: {
      type: "candlestick",
      height: "100%",
      width: "100%",
      background: COLORS.black,
      fontFamily: "DM Sans",
      toolbar: {
        autoSelected: "pan",
        show: false,
      },
    },
    noData: {
      text: "Loading...",
      align: "center",
      verticalAlign: "middle",
    },
    grid: {
      position: "back",
      borderColor: COLORS.gray[108],
    },
    title: undefined,
    xaxis: {
      type: "datetime",
      crosshairs: {
        show: false,
      },
      axisBorder: {
        show: false,
      },
      tooltip: {
        enabled: false,
      },
    },
    yaxis: {
      tooltip: {
        enabled: true,
        offsetX: -35,
      },
      crosshairs: {
        show: true,
        stroke: {
          color: COLORS.gray[140],
          width: 1,
        },
      },
      decimalsInFloat: 4,
    },
    plotOptions: {
      candlestick: {
        colors: {
          upward: COLORS.green,
          downward: COLORS.errorRed,
        },
      },
    },
  });

  const uptrend = () => {
    const info = priceInfo();
    if (!info) return undefined;

    let apy = 0.2;
    const apyBonus = 0.1;
    const t = 10_000_000_0000_0000n;

    console.log(info.total_supply, t);

    if (info.total_supply < t) {
      const bonusFactor = Number((t - info.total_supply) / t) / 1_0000_0000.0;
      apy += apyBonus * bonusFactor;
    }

    const apyPercent = (apy * 100.0).toFixed(2);

    return (
      <div class="rounded-2 bg-gray-105 flex p-1 h-[20px] items-center gap-2">
        <p class="font-semibold text-xs text-gray-140">APY</p>
        <p class="font-semibold text-xs text-white flex items-end">
          <span class="text-green">{apyPercent}%</span>
        </p>
      </div>
    );
  };

  const gravity = () => {
    const info = priceInfo();
    if (!info) return undefined;

    const g = info.cur_long_price - info.target_price;
    const v = Math.abs(g) < 0.0001 ? "0.0001" : Math.abs(g).toFixed(4);

    return (
      <div class="rounded-2 bg-gray-105 flex p-1 h-[20px] items-center gap-2">
        <p class="font-semibold text-xs text-gray-140">Gravity</p>
        <p class="font-semibold text-xs text-white flex items-end">
          {v}{" "}
          <Icon
            kind={EIconKind.ArrowUpRight}
            size={14}
            color={g > 0 ? COLORS.errorRed : COLORS.green}
            class={`relative ${g > 0 ? "rotate-90" : ""}`}
          />
        </p>
      </div>
    );
  };

  const trend = () => {
    const info = priceInfo();
    if (!info) return undefined;

    const v = Math.abs(info.cur_trend) < 0.00001 ? "~0.00001" : Math.abs(info.cur_trend).toFixed(5);

    return (
      <div class="rounded-2 bg-gray-105 flex p-1 h-[20px] items-center gap-2">
        <p class="font-semibold text-xs text-gray-140">Trend</p>
        <p class="font-semibold text-xs text-white flex items-end">
          {v}{" "}
          <Icon
            kind={EIconKind.ArrowUpRight}
            size={14}
            color={!info.cur_trend_sign ? COLORS.errorRed : COLORS.green}
            class={`relative ${!info.cur_trend_sign ? "rotate-90" : ""}`}
          />
        </p>
      </div>
    );
  };

  const curPrice = () => {
    const info = priceInfo();
    if (!info) return undefined;

    const p = props.kind === "long" ? info.cur_long_price : info.cur_short_price;

    return p.toFixed(4);
  };

  const curPriceChangePercent = () => {
    const info = priceInfo();
    if (!info) return undefined;

    const candle = props.kind === "long" ? info.cur_4h_long_candle : info.cur_4h_short_candle;
    const difPercent = ((candle.close - candle.open) / candle.open) * 100.0;

    return (
      <p classList={{ "text-green": difPercent >= 0, "text-errorRed": difPercent < 0 }}>
        {difPercent > 0 ? "+" : ""}
        {difPercent.toFixed(2)}%
      </p>
    );
  };

  return (
    <div class="flex flex-col gap-6" classList={{ [props.class!]: !!props.class }}>
      <div class="flex items-end justify-between relative">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-baseline relative left-4">
          <div class="flex gap-2 items-baseline sm:w-[300px]">
            <p class="font-semibold text-6xl">{curPrice()}</p>
            {curPriceChangePercent()}
          </div>
          <div class="flex gap-2 items-center flex-wrap">
            {uptrend()}
            {gravity()}
            {trend()}
          </div>
        </div>
        <div class="flex gap-6 h-[22px] text-xs items-center pl-4 font-semibold text-gray-140">
          <div class="flex gap-1 items-center">
            <p
              class="bg-gray-108 p-[2px] w-6 flex justify-center rounded-sm cursor-pointer hover:text-white"
              classList={{ "text-white": timing() === "4h" }}
              onClick={eventHandler(() => {
                setTiming("4h");
              })}
            >
              4H
            </p>
            <p
              class="bg-gray-108 p-[2px] w-6 flex justify-center rounded-sm cursor-pointer hover:text-white"
              classList={{ "text-white": timing() === "1d" }}
              onClick={eventHandler(() => {
                setTiming("1d");
              })}
            >
              D
            </p>
          </div>
        </div>
      </div>

      <div class="flex flex-col flex-grow relative">
        <SolidApexCharts type="candlestick" options={options()} series={series()} />
      </div>
    </div>
  );
}
