import { ROOT } from "@/routes";
import { Avatar } from "@components/avatar";
import { BalanceOf } from "@components/balance-of";
import { BooleanInput } from "@components/boolean-input";
import { Btn } from "@components/btn";
import { Copyable } from "@components/copyable";
import { EIconKind, Icon } from "@components/icon";
import { Modal } from "@components/modal";
import { Page } from "@components/page";
import { getAvatarSrc, getPseudonym, ProfileFull } from "@components/profile/profile";
import { Spoiler } from "@components/spoiler";
import { TextInput } from "@components/text-input";
import { AccountIdentifier, SubAccount } from "@dfinity/ledger-icp";
import { IcrcLedgerCanister } from "@dfinity/ledger-icrc";
import { Principal } from "@dfinity/principal";
import { MsqClient } from "@fort-major/msq-client";
import { areWeOnMobile } from "@pages/home";
import { useNavigate } from "@solidjs/router";
import { useAuth } from "@store/auth";
import { useBurner } from "@store/burner";
import { DEFAULT_TOKENS, useTokens } from "@store/tokens";
import { COLORS } from "@utils/colors";
import { avatarSrcFromPrincipal, createLocalStorageSignal } from "@utils/common";
import { bytesToHex, tokensToStr } from "@utils/encoding";
import { logInfo } from "@utils/error";
import { eventHandler } from "@utils/security";
import { ONE_MIN_NS, Result } from "@utils/types";
import { batch, createEffect, createResource, createSignal, For, Match, on, onMount, Show, Switch } from "solid-js";

export const PoolPage = () => {
  const { isAuthorized, identity, assertAuthorized } = useAuth();
  const { subaccounts, fetchSubaccountOf, claimLost, canClaimLost } = useTokens();
  const { canWithdraw, canStake, totals, fetchTotals, canClaimReward, withdraw, stake, stakeKamikaze, claimReward } =
    useBurner();
  const navigate = useNavigate();

  const [isKamikazePool, setIsKamikazePool] = createLocalStorageSignal<boolean>("msq-burn-is-kamikaze-pool");
  const [withdrawModalVisible, setWithdrawModalVisible] = createSignal(false);
  const [burnModalVisible, setBurnModalVisible] = createSignal(false);
  const [claimModalVisible, setClaimModalVisible] = createSignal(false);
  const [claimLostModalVisible, setClaimLostModalVisible] = createSignal(false);
  const [recepient, setRecepient] = createSignal(Result.Err<string>(""));

  const myPrincipal = () => {
    if (!isAuthorized()) return undefined;

    return identity()!.getPrincipal();
  };

  const mySubaccount = () => {
    const p = myPrincipal();
    if (!p) return undefined;

    return subaccounts[p.toText()];
  };

  const burnoutLeftoverBlocks = () => {
    const t = totals.data;
    if (!t) return 0;

    return Number(t.yourShareTcycles.div(t.currentBlockShareFee).toBigIntBase());
  };

  const highRiskMinutesLeft = () => {
    const t = totals.data;
    if (!t || !t.yourKamikazePositionCreatedAt) return 0;

    const now = Date.now();
    const harakiriAt = t.yourKamikazePositionCreatedAt.getTime() + 24 * 60 * 60 * 1000;

    let dif = 0;
    if (harakiriAt > now) {
      dif = harakiriAt - now;
    }

    return Math.floor(dif / 1000 / 60);
  };

  const myShare = () => {
    const t = totals.data;
    if (!t) return undefined;

    if (!t.totalSharesSupply.toBool()) return undefined;

    return t.yourShareTcycles.div(t.totalSharesSupply);
  };

  const myHighRiskShare = () => {
    const t = totals.data;
    if (!t) return undefined;

    if (!t.totalKamikazePoolSupply.toBool()) return undefined;

    return t.yourKamikazeShareTcycles.div(t.totalKamikazePoolSupply);
  };

  const myBlockCut = () => {
    const t = totals.data;
    if (!t) return undefined;

    if (!t.totalSharesSupply.toBool()) return undefined;

    const lotteryEnabled = t.isLotteryEnabled || t.isKamikazePoolEnabled;

    let reward = t.currentBurnTokenReward
      .toDynamic()
      .toDecimals(12)
      .mul(t.yourShareTcycles)
      .div(t.totalSharesSupply)
      .toDecimals(8)
      .toE8s();

    if (lotteryEnabled) {
      reward = reward.divNum(2n);
    }

    return reward;
  };

  const lotteryPostfix = () => {
    const t = totals.data;
    if (!t) return "";

    if (
      (t.isLotteryEnabled && t.yourLotteryEligibilityStatus) ||
      (t.isKamikazePoolEnabled && t.yourKamikazePositionCreatedAt)
    )
      return `+ a chance for ${t.currentBurnTokenReward
        .divNum(2n)
        .toShortString({ belowOne: 4, belowThousand: 0, afterThousand: 0 })} more BURN`;

    return "";
  };

  onMount(() => {
    if (!isAuthorized()) {
      navigate(ROOT.path);
      return;
    }

    fetchSubaccountOf(myPrincipal()!);
  });

  createEffect(
    on(isAuthorized, (ready) => {
      if (!ready) {
        navigate(ROOT.path);
      }
    })
  );

  createEffect(
    on(myPrincipal, (p) => {
      if (!p) return;

      fetchSubaccountOf(p);
    })
  );

  const headerClass = "font-semibold text-2xl";

  const handleWithdrawModalClose = () => {
    batch(() => {
      setRecepient(Result.Err<string>(""));
      setWithdrawModalVisible(false);
    });
  };

  const handleWithdraw = async () => {
    await withdraw(Principal.fromText(recepient().unwrapOk()));
    handleWithdrawModalClose();
  };

  const withdrawForm = (
    <div class="flex flex-col gap-8">
      <div class="flex flex-col gap-4">
        <p class="font-normal text-lg text-white">Are you sure you want to withdraw all ICP from the Pool?</p>
        <div class="flex flex-col gap-2">
          <p class="font-semibold text-sm text-gray-140">
            Recepient Principal ID <span class="text-errorRed">*</span>
          </p>
          <TextInput
            placeholder={import.meta.env.VITE_BURNER_CANISTER_ID}
            validations={[
              { principal: null },
              { required: null },
              { not: [import.meta.env.VITE_BURN_TOKEN_CANISTER_ID] },
            ]}
            value={recepient().unwrap()}
            onChange={setRecepient}
          />
        </div>
      </div>
      <Btn text="Confirm" bgColor={COLORS.orange} disabled={recepient().isErr()} onClick={handleWithdraw} />
    </div>
  );

  const handleBurnModalClose = () => {
    batch(() => {
      setBurnModalVisible(false);
    });
  };

  const handleBurn = async () => {
    if (isKamikazePool()) {
      await stakeKamikaze();
    } else {
      await stake();
    }

    handleBurnModalClose();
  };

  const burnForm = (
    <div class="flex flex-col gap-8">
      <div class="flex flex-col gap-4">
        <p class="font-normal text-lg text-white">Are you sure you want to burn all deposited ICP?</p>
        <p class="font-semibold text-orange">
          This operation takes a significant amount of time! Please, wait patiently after pressing "Yes".
        </p>
      </div>
      <div class="flex gap-2">
        <Btn text="No" class="flex-grow" bgColor={COLORS.gray[105]} onClick={handleBurnModalClose} />
        <Btn text="Yes" class="flex-grow" bgColor={COLORS.orange} onClick={handleBurn} />
      </div>
    </div>
  );

  const handleClaimModalClose = () => {
    batch(() => {
      setRecepient(Result.Err<string>(""));
      setClaimModalVisible(false);
    });
  };

  const handleClaim = async () => {
    await claimReward(Principal.fromText(recepient().unwrapOk()));
    handleClaimModalClose();
  };

  const claimForm = (
    <div class="flex flex-col gap-8">
      <div class="flex flex-col gap-4">
        <p class="font-normal text-lg text-white">Mint all unclaimed BURN tokens?</p>
        <div class="flex flex-col gap-2">
          <p class="font-normal text-sm text-white">
            $BURN is supported by an absolute majority of wallets. We still would like to kindly ask you to{" "}
            <span class="font-bold">check if the wallet you send to supports $BURN</span>.
          </p>
          <p class="font-semibold text-sm text-gray-140">
            Recepient Principal ID <span class="text-errorRed">*</span>
          </p>
          <TextInput
            placeholder={import.meta.env.VITE_BURNER_CANISTER_ID}
            validations={[
              { principal: null },
              { required: null },
              { not: [import.meta.env.VITE_BURN_TOKEN_CANISTER_ID] },
            ]}
            value={recepient().unwrap()}
            onChange={setRecepient}
          />
        </div>
      </div>
      <Btn text="Confirm" bgColor={COLORS.orange} disabled={recepient().isErr()} onClick={handleClaim} />
    </div>
  );

  const handleClaimLostModalClose = () => {
    batch(() => {
      setRecepient(Result.Err<string>(""));
      setClaimLostModalVisible(false);
    });
  };

  const handleClaimLost = async () => {
    assertAuthorized();

    await claimLost(Principal.fromText(recepient().unwrapOk()));

    handleClaimLostModalClose();
  };

  const claimLostForm = (
    <div class="flex flex-col gap-8">
      <div class="flex flex-col gap-4">
        <p class="font-normal text-lg text-white">Your lost assets we were able to find:</p>
        <div class="flex flex-col gap-2">
          <BalanceOf tokenId={DEFAULT_TOKENS.burn} owner={identity()?.getPrincipal()} />
          <BalanceOf tokenId={DEFAULT_TOKENS.icp} owner={identity()?.getPrincipal()} />
        </div>
        <div class="flex flex-col gap-2">
          <p class="font-semibold text-sm text-gray-140">
            Recepient Principal ID <span class="text-errorRed">*</span>
          </p>
          <TextInput
            placeholder={import.meta.env.VITE_BURNER_CANISTER_ID}
            validations={[
              { principal: null },
              { required: null },
              { not: [import.meta.env.VITE_BURN_TOKEN_CANISTER_ID] },
            ]}
            value={recepient().unwrap()}
            onChange={setRecepient}
          />
        </div>
      </div>
      <Btn
        text="Re-claim Lost Assets"
        bgColor={COLORS.orange}
        disabled={recepient().isErr() || !canClaimLost()}
        onClick={handleClaimLost}
      />
    </div>
  );

  return (
    <Page slim>
      <ProfileFull />

      <div class="flex flex-col gap-4">
        <p class={headerClass}>Deposited ICP</p>
        <div class="flex flex-col md:flex-row md:justify-between gap-10 md:gap-4">
          <Show when={mySubaccount()}>
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-2">
                <p class="font-semibold text-gray-140 text-sm">Send ICP here to deposit (1 ICP minimum)</p>

                <div class="flex flex-col gap-1">
                  <p class="font-semibold text-md">Account ID</p>
                  <Copyable
                    text={AccountIdentifier.fromPrincipal({
                      principal: Principal.fromText(import.meta.env.VITE_BURNER_CANISTER_ID),
                      subAccount: SubAccount.fromBytes(mySubaccount()!) as SubAccount,
                    }).toHex()}
                    ellipsis={areWeOnMobile() ? true : false}
                    ellipsisSymbols={areWeOnMobile() ? 30 : undefined}
                  />
                </div>
              </div>
              <BalanceOf
                tokenId={DEFAULT_TOKENS.icp}
                owner={Principal.fromText(import.meta.env.VITE_BURNER_CANISTER_ID)}
                subaccount={mySubaccount()!}
              />
            </div>
          </Show>
          <div class="flex flex-col md:items-center gap-4">
            <Btn
              text="Burn"
              class="md:w-[200px]"
              bgColor={COLORS.orange}
              icon={EIconKind.FlameBW}
              disabled={!canStake()}
              onClick={() => setBurnModalVisible(true)}
            />
            <Show when={totals.data?.isKamikazePoolEnabled}>
              <BooleanInput
                labelOn="High-Risk"
                labelOff="High-Risk"
                value={isKamikazePool() || false}
                onChange={setIsKamikazePool}
              />
            </Show>
            <Show when={canWithdraw()}>
              <p
                class="underline font-normal text-gray-140 cursor-pointer text-center"
                onClick={eventHandler(() => {
                  setWithdrawModalVisible(true);
                })}
              >
                Withdraw
              </p>
            </Show>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-4">
        <p class={headerClass}>Unclaimed BURN</p>
        <div class="flex flex-col md:flex-row md:justify-between gap-10 md:gap-4">
          <Show when={totals.data}>
            <div class="flex flex-col gap-1">
              <BalanceOf
                tokenId={DEFAULT_TOKENS.burn}
                onRefreshOverride={fetchTotals}
                balance={totals.data!.yourUnclaimedReward.toBigIntRaw()}
              />
              <p class="text-sm text-gray-140">
                Reward per Block: {myBlockCut()?.toString() ?? 0} BURN {lotteryPostfix()}
              </p>
              <p class="text-sm text-gray-140">
                Classic Pool Share: {myShare()?.toPercent().toDecimals(4).toString() ?? 0}% (
                {totals.data?.yourShareTcycles?.toString()} / {totals.data?.totalSharesSupply.toString()})
              </p>
              <p class="text-sm text-gray-140">
                High-Risk Pool Winning Chance: {myHighRiskShare()?.toPercent().toDecimals(4).toString() ?? 0}% (
                {totals.data?.yourKamikazeShareTcycles?.toString()} / {totals.data?.totalKamikazePoolSupply.toString()})
              </p>
            </div>

            <div class="flex flex-col md:items-center gap-4">
              <Btn
                text="Claim"
                icon={EIconKind.ArrowUpRight}
                class="md:w-[200px]"
                bgColor={COLORS.orange}
                iconClass="rotate-180"
                iconColor={COLORS.white}
                disabled={!canClaimReward()}
                onClick={() => setClaimModalVisible(true)}
              />
              <Show when={canClaimLost()}>
                <p
                  class="underline font-normal text-gray-140 cursor-pointer text-center"
                  onClick={eventHandler(() => {
                    setClaimLostModalVisible(true);
                  })}
                >
                  Re-claim Lost
                </p>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <div class="flex flex-col gap-4">
        <Show
          fallback={<p class={headerClass}>Burn ICP in High-Risk Pool to Continue</p>}
          when={totals.data && burnoutLeftoverBlocks()!}
        >
          <div class="flex flex-row justify-between items-center gap-4">
            <p class={headerClass}>High-Risk Pool Minting In Progress</p>
          </div>
          <p>Your position will be removed in {highRiskMinutesLeft()} minutes</p>
          <div class="flex flex-wrap gap-2">
            <For each={Array(highRiskMinutesLeft()!).fill(0)}>
              {(_, idx) => (
                <Icon
                  class={idx() === highRiskMinutesLeft() - 1 ? "animate-pulse" : undefined}
                  kind={EIconKind.BlockEmpty}
                  color={COLORS.orange}
                />
              )}
            </For>
          </div>
        </Show>
      </div>

      <div class="flex flex-col gap-4">
        <Show
          fallback={<p class={headerClass}>Burn ICP in Classic Pool to Continue</p>}
          when={totals.data && burnoutLeftoverBlocks()!}
        >
          <div class="flex flex-row justify-between items-center gap-4">
            <p class={headerClass}>Classic Pool Minting In Progress</p>
          </div>
          <p>
            Enough fuel for {burnoutLeftoverBlocks()} blocks (approx.{" "}
            {((totals.data!.posRoundDelayNs * BigInt(burnoutLeftoverBlocks()!)) / ONE_MIN_NS).toString()} minutes)
          </p>
          <div class="flex flex-wrap gap-2">
            <For each={Array(burnoutLeftoverBlocks()!).fill(0)}>
              {(_, idx) => {
                return idx() < 100 || idx() === burnoutLeftoverBlocks()! - 1 ? (
                  <Icon
                    class={idx() === burnoutLeftoverBlocks() - 1 ? "animate-pulse" : undefined}
                    kind={EIconKind.BlockFilled}
                    color={COLORS.orange}
                  />
                ) : idx() === 100 ? (
                  <p class="w-6 text-center">...</p>
                ) : undefined;
              }}
            </For>
          </div>
        </Show>
      </div>

      <Switch>
        <Match when={withdrawModalVisible()}>
          <Modal title="Withdraw unburnt ICP" onClose={handleWithdrawModalClose}>
            {withdrawForm}
          </Modal>
        </Match>
        <Match when={burnModalVisible()}>
          <Modal
            title={`Burn ICP in the ${isKamikazePool() ? "High-Risk" : "Classic"} Pool`}
            onClose={handleBurnModalClose}
          >
            {burnForm}
          </Modal>
        </Match>
        <Match when={claimModalVisible()}>
          <Modal title="Claim BURN" onClose={handleClaimModalClose}>
            {claimForm}
          </Modal>
        </Match>
        <Match when={claimLostModalVisible()}>
          <Modal title="Claim Lost Tokens" onClose={handleClaimLostModalClose}>
            {claimLostForm}
          </Modal>
        </Match>
      </Switch>
    </Page>
  );
};
