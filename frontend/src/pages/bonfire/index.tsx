import { Avatar } from "@components/avatar";
import { BalanceOf } from "@components/balance-of";
import { Bento, BentoBox } from "@components/bento";
import { Btn } from "@components/btn";
import { Copyable } from "@components/copyable";
import { EIconKind, Icon } from "@components/icon";
import { Modal } from "@components/modal";
import { Page } from "@components/page";
import { PledgeForm } from "@components/pledge-form";
import { QtyInput } from "@components/qty-input";
import { Timer } from "@components/timer";
import { Principal } from "@dfinity/principal";
import { useAuth } from "@store/auth";
import { useFurnace } from "@store/furnace";
import { DEFAULT_TOKENS, useTokens } from "@store/tokens";
import { useWallet } from "@store/wallet";
import { COLORS } from "@utils/colors";
import { avatarSrcFromPrincipal } from "@utils/common";
import { err, ErrorCode, logErr } from "@utils/error";
import { E8s, EDs } from "@utils/math";
import { eventHandler } from "@utils/security";
import { getTimeUntilNextSunday15UTC } from "@utils/time";
import { Result } from "@utils/types";
import { batch, createEffect, createSignal, For, on, onMount, Show } from "solid-js";

export function BonfirePage() {
  const { identity, isReadyToFetch, isAuthorized, assertAuthorized } = useAuth();
  const { fetchBalanceOf, balanceOf, metadata, icpSwapUsdExchangeRates } = useTokens();
  const { pidBalance, transfer, moveToBonfireAccount, withdrawFromBonfireAccount, pid } = useWallet();
  const { pledge, curRoundPositions, fetchCurRoundPositions, fetchInfo, info, myShares, fetchMyShares } = useFurnace();

  const [pledgeModalOpen, setPledgeModalOpen] = createSignal(false);
  const [pledgingToken, setPledgingToken] = createSignal<Principal>();

  const prizeFund = () => {
    const furnaceBalance = balanceOf(DEFAULT_TOKENS.icp, Principal.fromText(import.meta.env.VITE_FURNACE_CANISTER_ID));

    if (furnaceBalance === undefined) {
      return E8s.zero();
    }

    return E8s.new(furnaceBalance).mul(E8s.new(8500_0000n));
  };

  onMount(() => {
    if (isReadyToFetch()) {
      if (prizeFund().eq(E8s.zero())) {
        fetchBalanceOf(DEFAULT_TOKENS.icp, Principal.fromText(import.meta.env.VITE_FURNACE_CANISTER_ID));
      }

      fetchInfo();

      if (curRoundPositions().length == 0) {
        fetchCurRoundPositions();
      }
    }
  });

  createEffect(
    on(isReadyToFetch, (ready) => {
      if (ready) {
        if (prizeFund().eq(E8s.zero())) {
          fetchBalanceOf(DEFAULT_TOKENS.icp, Principal.fromText(import.meta.env.VITE_FURNACE_CANISTER_ID));
        }

        fetchInfo();

        if (curRoundPositions().length == 0) {
          fetchCurRoundPositions();
        }
      }
    })
  );

  const handlePledge = async (token: Principal, qty: bigint) => {
    assertAuthorized();

    const meta = metadata[token.toText()];
    if (!meta) {
      err(ErrorCode.UNREACHEABLE, "No token metadata present");
    }

    await moveToBonfireAccount(token, qty);

    try {
      await pledge({
        tokenCanId: token,
        pid: pid()!,
        qty: qty - meta.fee.val,
        downvote: false,
      });
    } catch (e) {
      logErr(ErrorCode.NETWORK, "Unable to pledge");
      console.error(e);

      await withdrawFromBonfireAccount(token, qty - meta.fee.val);
    } finally {
      fetchMyShares();
      fetchCurRoundPositions();
    }

    handlePledgeModalClose();
  };

  const handlePledgeModalClose = () => {
    setPledgeModalOpen(false);
  };

  const handlePledgeClick = (tokenCanId: Principal) => {
    batch(() => {
      setPledgingToken(tokenCanId);
      setPledgeModalOpen(true);
    });
  };

  const canPledge = (tokenCanId: Principal) => {
    const b = pidBalance(tokenCanId);
    if (!b) return false;
    if (b < 10) return false;

    return true;
  };

  createEffect(() => {
    if (isAuthorized()) {
      fetchMyShares();
    }
  });

  const drawChance = () => {
    const shares = myShares();
    if (!shares) return undefined;

    const i = info();
    if (!i) return undefined;

    if (i.curRoundPledgedUsd.isZero()) return E8s.zero();

    return shares.usd.div(i.curRoundPledgedUsd);
  };

  const votingPower = () => {
    const shares = myShares();
    if (!shares) return undefined;

    const i = info();
    if (!i) return undefined;

    if (i.curRoundPledgedBurnUsd.isZero()) return E8s.zero();

    return shares.votingPower.div(i.curRoundPledgedBurnUsd);
  };

  const curTokenXTicker = () => {
    const token = info()?.curTokenX;
    if (!token) return undefined;

    const m = metadata[token.toText()];
    if (!m) return undefined;

    return m.ticker;
  };

  const modalTitle = () => {
    const t = pledgingToken();
    if (!t) return undefined;

    const token = info()?.curTokenX;
    if (!token) return undefined;

    if (t.compareTo(token) === "eq") {
      const m = metadata[token.toText()];
      if (!m) return undefined;

      return `Pledge $${m.ticker}`;
    }

    return "Pledge $BURN";
  };

  const totalShareWorth = () =>
    curRoundPositions()
      .map((it) => it.usd)
      .reduce((prev, cur) => prev.add(cur), E8s.zero());

  const avgShareWorth = () =>
    curRoundPositions()
      .map((it) => it.usd)
      .reduce((prev, cur) => prev.add(cur), E8s.zero())
      .div(E8s.fromBigIntBase(BigInt(curRoundPositions().length || 1)));

  return (
    <Page slim>
      <div class="flex gap-5 flex-col justify-center items-center">
        <p class="text-xl sm:text-4xl">This Week's Prize Fund</p>
        <div class="flex gap-4 sm:gap-6 items-center">
          <Icon kind={EIconKind.ICP} color="white" size={window.innerWidth > 800 ? 120 : 60} />
          <h2 class="font-semibold leading-[70px] text-[70px] sm:leading-[200px] sm:text-[200px]">
            {prizeFund().toDynamic().toDecimals(0).toString()} <span class="text-xl italic font-normal">ICP</span>
          </h2>
        </div>
      </div>

      <div class="flex flex-col gap-6">
        <div class="grid grid-cols-2 gap-6">
          <Bento class="flex-col" id={3}>
            <div class="flex flex-col gap-8">
              <p class="font-semibold text-xl">Bonfire Pool</p>

              <Show when={isAuthorized() && myShares()} fallback={<p class="text-orange">Sign In To Participate</p>}>
                <div class="flex flex-col gap-4">
                  <div class="flex gap-4 justify-between items-baseline">
                    <p class="font-bold text-6xl">
                      ${myShares()!.usd.toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 2 })}
                    </p>
                    <p class="text-gray-140">pledged USD</p>
                  </div>

                  <div class="flex gap-4 justify-between items-baseline">
                    <p class="font-bold text-4xl">
                      {drawChance()!.toPercent().toShortString({ belowOne: 4, belowThousand: 2, afterThousand: 2 })}%
                    </p>
                    <p class="text-gray-140">chance to draw</p>
                  </div>

                  <div class="flex gap-4 justify-between items-baseline">
                    <p class="font-bold text-4xl">
                      {votingPower()!.toPercent().toShortString({ belowOne: 4, belowThousand: 2, afterThousand: 2 })}%
                    </p>
                    <p class="text-gray-140">voting power</p>
                  </div>
                </div>

                <div class="flex flex-col gap-2">
                  <Btn
                    text="Pledge $BURN"
                    bgColor={COLORS.orange}
                    class="w-full font-semibold"
                    disabled={!canPledge(DEFAULT_TOKENS.burn)}
                    onClick={() => handlePledgeClick(DEFAULT_TOKENS.burn)}
                  />
                  <Show when={info() && info()!.curTokenX.compareTo(DEFAULT_TOKENS.burn) !== "eq"}>
                    <Btn
                      text={`Pledge $${curTokenXTicker()}`}
                      bgColor={COLORS.orange}
                      class="w-full font-semibold"
                      disabled={!canPledge(info()!.curTokenX)}
                      onClick={() => handlePledgeClick(info()!.curTokenX)}
                    />
                  </Show>
                </div>
              </Show>
            </div>
          </Bento>

          <Bento class="flex-col" id={2}>
            <div class="flex flex-col gap-6">
              <p class="font-semibold text-xl">Rules</p>
              <ol class="flex flex-col gap-1 list-decimal list-inside text-sm">
                <li>
                  <b>Weekly</b> prize fund distribution, <b>one winner takes all</b>.
                </li>
                <li>
                  More $ pledged = <b>higher chance of winning</b>.
                </li>
                <li>
                  At the end of the week <b>all positions expire</b>.
                </li>
                <li>
                  Pledge <span class="text-orange">$BURN</span> or <b>another token</b>.
                </li>
                <li>
                  Only pledging <span class="text-orange">$BURN</span> <b>gives voting power</b>.
                </li>
                <li>
                  Voting power is used to select next week's <b>another token</b>.
                </li>
                <li>
                  All current week's Bonfire participants <b>are eligible</b> for next week's airdrops.
                </li>
              </ol>
            </div>
          </Bento>
        </div>

        <div class="grid grid-cols-2 gap-6">
          <Bento class="flex-col" id={3}>
            <Timer {...getTimeUntilNextSunday15UTC()} class="text-2xl" descriptionClass="text-xl" />
            <p class="text-gray-140">Before the winner is selected</p>
          </Bento>
          <Bento class="flex-col" id={4}>
            <Timer {...getTimeUntilNextSunday15UTC(12)} class="text-2xl" descriptionClass="text-xl" />
            <p class="text-orange">Until not eligible for next week airdrops</p>
          </Bento>
        </div>
      </div>

      <div class=""></div>

      <div class="flex flex-col gap-4">
        <p class="text-white font-semibold text-4xl flex gap-4 items-center">Current Round Participants</p>
        <div class="flex flex-col gap-4">
          <div class="mb-2 grid grid-cols-4 md:grid-cols-5 items-start md:items-center gap-3 text-xs font-semibold text-gray-140">
            <p class="col-span-1 text-right"></p>
            <p class="col-span-1 text-right hidden md:block">PID</p>
            <p class="col-span-1 text-right">Deposited $</p>
            <p class="col-span-1 text-right">Voting Power</p>
            <p class="col-span-1 text-right">Draw %</p>
          </div>

          <div class="flex flex-col gap-2">
            <Show when={info()}>
              <For each={curRoundPositions()} fallback={<p class="text-sm text-gray-140">Nothing here yet :(</p>}>
                {(position, idx) => {
                  const i = info()!;

                  const poolSharePercent = position.usd
                    .div(i.curRoundPledgedUsd || E8s.fromBigIntBase(1n))
                    .toPercent()
                    .toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 1 });

                  return (
                    <div class="grid p-2 grid-cols-4 md:grid-cols-5 items-center gap-3 odd:bg-gray-105 even:bg-black relative">
                      <div class="flex items-center gap-1 col-span-1">
                        <p
                          class="text-xs text-gray-140 font-semibold min-w-7"
                          classList={{ ["text-white"]: identity()?.getPrincipal().compareTo(position.pid) === "eq" }}
                        >
                          {idx() + 1}
                        </p>
                        <Avatar
                          url={avatarSrcFromPrincipal(position.pid)}
                          size="sm"
                          borderColor={
                            identity()?.getPrincipal().compareTo(position.pid) === "eq"
                              ? COLORS.chartreuse
                              : COLORS.gray[140]
                          }
                        />
                      </div>

                      <Copyable class="col-span-1 hidden md:flex" text={position.pid.toText()} ellipsis />

                      <p class="col-span-1 font-semibold text-gray-140 text-md text-right">
                        {position.usd.toShortString({ belowOne: 2, belowThousand: 1, afterThousand: 2 })}
                      </p>

                      <p class="col-span-1 font-semibold text-gray-140 text-md text-right">
                        <Show when={i.curRoundPledgedUsd.toBigIntRaw() > 0n}>{poolSharePercent}%</Show>
                      </p>

                      <p class="col-span-1 font-semibold text-gray-140 text-md text-right">
                        <Show when={i.curRoundPledgedUsd.toBigIntRaw() > 0n}>{poolSharePercent}%</Show>
                      </p>
                    </div>
                  );
                }}
              </For>
            </Show>
          </div>

          <div class="grid px-2 grid-cols-4 sm:grid-cols-5 items-center gap-3 text-md font-semibold text-gray-190">
            <p class="col-span-1 text-right">Average</p>
            <p class="col-span-1 text-right font-semibold">${avgShareWorth().toDynamic().toDecimals(0).toString()}</p>
            <p class="col-span-2 text-right">Total</p>
            <p class="col-span-1 text-right font-semibold">${totalShareWorth().toDynamic().toDecimals(0).toString()}</p>
          </div>
        </div>
      </div>

      <Show when={pledgeModalOpen() && pledgingToken()}>
        <Modal title={modalTitle()} onClose={handlePledgeModalClose}>
          <PledgeForm onPledge={handlePledge} tokenCanId={pledgingToken()!} />
        </Modal>
      </Show>
    </Page>
  );
}
