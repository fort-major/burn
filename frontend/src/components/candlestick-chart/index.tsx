import { Candle } from "@/declarations/trading/trading.did";
import { Bento } from "@components/bento";
import { EIconKind, Icon } from "@components/icon";
import { useAuth } from "@store/auth";
import { useTrading } from "@store/trading";
import { useWallet } from "@store/wallet";
import { COLORS } from "@utils/colors";
import { eventHandler } from "@utils/security";
import { IClass, ONE_HOUR_NS, ONE_WEEK_NS } from "@utils/types";
import { ApexOptions } from "apexcharts";
import { SolidApexCharts } from "solid-apexcharts";
import { Accessor, createEffect, createMemo, createSignal, on, onMount } from "solid-js";

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
  } = useTrading();
  const [timing, setTiming] = createSignal<"1d" | "4h">("1d");

  const [activeCurrentCandle, setActiveCurrentCandle] = createSignal<Candle | undefined>(
    props.kind === "long" ? priceInfo()?.cur_1d_long_candle : priceInfo()?.cur_1d_short_candle
  );
  const [activeHistory, setActiveHistory] = createSignal<Candle[]>(
    props.kind === "long" ? longPriceHistory1d : shortPriceHistory1d
  );

  createEffect(
    on(activeHistory, (candles) => {
      if (candles.length === 0 && isReadyToFetch()) {
        fetchPriceHistory(props.kind === "short", timing());
      }
    })
  );

  createEffect(
    on(isReadyToFetch, (ready) => {
      if (ready && activeHistory().length === 0) {
        fetchPriceHistory(props.kind === "short", timing());
      }
    })
  );

  const setActivePriceHistory = () => {
    if (props.kind === "long" && timing() === "1d") setActiveHistory(longPriceHistory1d);
    if (props.kind === "long" && timing() === "4h") setActiveHistory(longPriceHistory4h);
    if (props.kind === "short" && timing() === "1d") setActiveHistory(shortPriceHistory1d);
    if (props.kind === "short" && timing() === "4h") setActiveHistory(shortPriceHistory4h);
  };

  onMount(() => {
    setActivePriceHistory();
  });

  createEffect(() => {
    setActivePriceHistory();
  });

  createEffect(
    on(priceInfo, (info) => {
      if (!info) return;

      if (props.kind === "long" && timing() === "1d") setActiveCurrentCandle(info.cur_1d_long_candle);
      if (props.kind === "long" && timing() === "4h") setActiveCurrentCandle(info.cur_4h_long_candle);
      if (props.kind === "short" && timing() === "1d") setActiveCurrentCandle(info.cur_1d_short_candle);
      if (props.kind === "short" && timing() === "4h") setActiveCurrentCandle(info.cur_4h_short_candle);
    })
  );

  const series = createMemo(() => {
    const data = activeHistory().map((it) => ({
      x: new Date(Number(it.open_ts / 1000_000n)),
      y: [it.open.toFixed(4), it.high.toFixed(4), it.low.toFixed(4), it.close.toFixed(4)],
    }));

    const cur = activeCurrentCandle();
    if (cur) {
      data.push({
        x: new Date(Number(cur.open_ts / 1000_000n)),
        y: [cur.open.toFixed(4), cur.high.toFixed(4), cur.low.toFixed(4), cur.close.toFixed(4)],
      });
    }

    return [{ data }];
  });

  const [options] = createSignal<ApexOptions>({
    tooltip: {
      style: {
        fontFamily: "DM Sans",
      },
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
        tools: {
          pan: true,
          zoomin: true,
          zoomout: true,
          download: false,
          zoom: false,
          reset: false,
        },
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
    title: {
      text: "",
      align: "left",
    },
    xaxis: {
      type: "datetime",
      axisBorder: {
        show: false,
      },
    },
    yaxis: {
      tooltip: {
        enabled: true,
      },
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

    const v = Math.abs(info.cur_trend) < 0.0001 ? "0.0001" : Math.abs(info.cur_trend).toFixed(4);

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

  return (
    <div class="flex flex-col relative" classList={{ [props.class!]: !!props.class }}>
      <SolidApexCharts type="bar" options={options()} series={series()} />

      <div class="absolute left-0 top-0 flex gap-6 h-[22px] text-xs items-center pl-4 font-semibold text-gray-140">
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
        <div class="flex gap-2 items-center">
          {gravity()}
          {trend()}
        </div>
      </div>
    </div>
  );
}
