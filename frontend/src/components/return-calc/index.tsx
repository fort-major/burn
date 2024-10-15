import { useBurner } from "@store/burner";
import { useTokens } from "@store/tokens";
import { E8s } from "@utils/math";
import { eventHandler } from "@utils/security";
import { createSignal, Show } from "solid-js";

export interface IReturnCalculatorProps {}

export const ReturnCalculator = () => {
  const { totals } = useBurner();
  const { icpSwapUsdExchangeRates } = useTokens();

  const [investmentUsd, setInvestmentUsd] = createSignal(E8s.fromBigIntBase(100n));
  const [poolSharePercent, setPoolSharePercent] = createSignal(115);

  const tcyclesExchangeRate = () => icpSwapUsdExchangeRates["aanaa-xaaaa-aaaah-aaeiq-cai"];
  const fuel = () => {
    const rate = tcyclesExchangeRate();
    if (!rate) return undefined;

    return investmentUsd().div(rate);
  };
  const blocks = () => {
    const f = fuel();
    if (!f) return undefined;

    const t = totals.data;
    if (!t) return undefined;

    const result = f.toDynamic().toDecimals(12).div(t.currentBlockShareFee).toDecimals(0).toDecimals(8).toE8s();

    return result;
  };
  const burn = () => {
    const b = blocks();
    if (!b) return undefined;

    const t = totals.data!;
    const shareAbs = E8s.fromPercentNum(poolSharePercent()).divNum(100n);

    return unwrapRewards(b.toBigIntBase(), t.currentPosRound, t.isLotteryEnabled || t.isKamikazePoolEnabled).mul(
      shareAbs
    );
  };

  const handleMyInvestmentChange = eventHandler((e: Event & { target: HTMLInputElement }) => {
    setInvestmentUsd(E8s.fromBigIntBase(BigInt(e.target.value)));
  });

  const handlePoolShareChange = eventHandler((e: Event & { target: HTMLInputElement }) => {
    setPoolSharePercent(parseInt(e.target.value));
  });

  return (
    <div class="flex flex-col md:flex-row gap-10 md:gap-20">
      <div class="flex flex-col gap-4 flex-grow">
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <p class="text-gray-140 text-lg font-thin">I Burn</p>
            <p class="text-2xl font-semibold">${investmentUsd().toBigIntBase().toString()}</p>
          </div>
          <input
            type="range"
            class="flex-grow cursor-pointer bg-gray-110 rounded-full h-2 appearance-none"
            value={Number(investmentUsd().toBigIntBase())}
            onInput={handleMyInvestmentChange}
            min={10}
            max={10000}
            step={10}
          />
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <p class="text-gray-140 text-lg font-thin">My Pool Share</p>
            <p class="text-2xl font-semibold">{(poolSharePercent() / 100).toFixed(2)}%</p>
          </div>
          <input
            type="range"
            class="flex-grow cursor-pointer bg-gray-110 rounded-full h-2 appearance-none"
            value={poolSharePercent()}
            onInput={handlePoolShareChange}
            min={0}
            max={10000}
            step={1}
          />
        </div>
      </div>
      <div class="flex flex-col gap-4 text-right md:flex-shrink md:w-80">
        <Show when={totals.data && fuel()}>
          <div class="flex flex-col">
            <p class="font-semibold text-6xl leading-[50px]">
              {burn()!.toShortString({ belowOne: 4, belowThousand: 2, afterThousand: 1 })}
            </p>
            <p class="text-gray-140">minimum BURN reward</p>
          </div>
          <div class="flex flex-col">
            <p class="font-semibold text-6xl leading-[50px]">{blocks()!.toDynamic().toDecimals(0).toString()}</p>
            <p class="text-gray-140">blocks till out of fuel</p>
          </div>
        </Show>
      </div>
    </div>
  );
};

function unwrapRewards(blocksLeft: bigint, curBlock: bigint, lotteryEnabled: boolean): E8s {
  const epoch = curBlock / 5040n;
  let curBlockReward = 1024_0000_0000n / 2n ** epoch;

  if (curBlockReward < 1_0000_0000n) {
    curBlockReward = 1_0000_0000n;
  }

  if (lotteryEnabled) {
    curBlockReward /= 2n;
  }

  const blocksTilHalving = 5040n - (curBlock % 5040n);
  if (blocksTilHalving > blocksLeft) {
    return E8s.new(curBlockReward).mulNum(blocksLeft);
  }

  return E8s.new(curBlockReward)
    .mulNum(blocksTilHalving)
    .add(unwrapRewards(blocksLeft - blocksTilHalving, curBlock + blocksTilHalving, lotteryEnabled));
}
