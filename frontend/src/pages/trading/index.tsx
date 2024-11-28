import { Bento } from "@components/bento";
import { CandlestickChart } from "@components/candlestick-chart";
import { EIconKind, Icon } from "@components/icon";
import { Page } from "@components/page";
import { COLORS } from "@utils/colors";
import { eventHandler } from "@utils/security";
import { createSignal } from "solid-js";

export function TradingPage() {
  const [mode, setMode] = createSignal<"long" | "short">("long");

  return (
    <Page>
      <div class="grid grid-cols-12 gap-4">
        <Bento id={0} class="col-span-3 flex flex-col">
          <div class="grid grid-cols-2 gap-2 text-center font-semibold text-lg text-gray-140 cursor-pointer">
            <p
              class="border-b border-b-[transparent] pb-2 hover:text-white hover:border-b-white flex gap-1 items-center justify-center"
              classList={{ "text-white border-b-white": mode() === "long" }}
              onClick={eventHandler(() => {
                setMode("long");
              })}
            >
              LONG
              <Icon kind={EIconKind.ArrowUpRight} color={COLORS.green} />
            </p>
            <p
              class="border-b border-b-[transparent] pb-2 hover:text-white hover:border-b-white flex gap-1 items-center justify-center"
              classList={{ "text-white border-b-white": mode() === "short" }}
              onClick={eventHandler(() => {
                setMode("short");
              })}
            >
              SHORT
              <Icon kind={EIconKind.ArrowUpRight} class="rotate-90" color={COLORS.errorRed} />
            </p>
          </div>

          <div class="h-[300px]"></div>
        </Bento>
        <CandlestickChart class="col-span-9" kind="long" />
      </div>
    </Page>
  );
}
