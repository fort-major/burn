import { ROOT } from "@/routes";
import { Avatar } from "@components/avatar";
import { BalanceOf } from "@components/balance-of";
import { Btn } from "@components/btn";
import { Copyable } from "@components/copyable";
import { EIconKind, Icon } from "@components/icon";
import { Modal } from "@components/modal";
import { Page } from "@components/page";
import { TextInput } from "@components/text-input";
import { Principal } from "@dfinity/principal";
import { useNavigate } from "@solidjs/router";
import { useAuth } from "@store/auth";
import { useBurner } from "@store/burner";
import { DEFAULT_TOKENS, useTokens } from "@store/tokens";
import { COLORS } from "@utils/colors";
import { avatarSrcFromPrincipal } from "@utils/common";
import { bytesToHex } from "@utils/encoding";
import { eventHandler } from "@utils/security";
import { ONE_MIN_NS, Result } from "@utils/types";
import { batch, createEffect, createSignal, For, Match, on, onMount, Show, Switch } from "solid-js";

export const PoolPage = () => {
  const { isAuthorized, identity } = useAuth();
  const { subaccounts, fetchSubaccountOf } = useTokens();
  const {
    canWithdraw,
    canStake,
    totals,
    fetchTotals,
    canClaimReward,
    withdraw,
    stake,
    claimReward,
    poolMembers,
    fetchPoolMembers,
  } = useBurner();
  const navigate = useNavigate();

  const [withdrawModalVisible, setWithdrawModalVisible] = createSignal(false);
  const [burnModalVisible, setBurnModalVisible] = createSignal(false);
  const [claimModalVisible, setClaimModalVisible] = createSignal(false);
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

  const myShare = () => {
    const t = totals.data;
    if (!t) return undefined;

    if (!t.totalSharesSupply.toBool()) return undefined;

    return t.yourShareTcycles.div(t.totalSharesSupply);
  };

  const myBlockCut = () => {
    const t = totals.data;
    if (!t) return undefined;

    if (!t.totalSharesSupply.toBool()) return undefined;

    return t.currentBurnTokenReward
      .toDynamic()
      .toDecimals(12)
      .mul(t.yourShareTcycles)
      .div(t.totalSharesSupply)
      .toDecimals(8)
      .toE8s();
  };

  onMount(() => {
    if (!isAuthorized()) {
      navigate(ROOT.path);
      return;
    }

    fetchPoolMembers();
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
            validations={[{ principal: null }, { required: null }]}
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
    await stake();
    handleBurnModalClose();
  };

  const burnForm = (
    <div class="flex flex-col gap-8">
      <div class="flex flex-col gap-4">
        <p class="font-normal text-lg text-white">Are you sure you want to burn all deposited ICP?</p>
      </div>
      <div class="flex gap-2">
        <Btn text="No" bgColor={COLORS.gray[105]} onClick={handleBurnModalClose} />
        <Btn text="Yes" bgColor={COLORS.orange} onClick={handleBurn} />
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
          <p class="font-semibold text-sm text-gray-140">
            Recepient Principal ID <span class="text-errorRed">*</span>
          </p>
          <TextInput
            placeholder={import.meta.env.VITE_BURNER_CANISTER_ID}
            validations={[{ principal: null }, { required: null }]}
            value={recepient().unwrap()}
            onChange={setRecepient}
          />
        </div>
      </div>
      <Btn text="Confirm" bgColor={COLORS.orange} disabled={recepient().isErr()} onClick={handleClaim} />
    </div>
  );

  return (
    <Page slim>
      <div class="flex flex-col gap-4">
        <p class={headerClass}>Deposited ICP</p>
        <div class="flex justify-between gap-4">
          <Show when={mySubaccount()}>
            <div class="flex flex-col gap-2">
              <BalanceOf
                tokenId={DEFAULT_TOKENS.icp}
                owner={Principal.fromText(import.meta.env.VITE_BURNER_CANISTER_ID)}
                subaccount={mySubaccount()!}
              />
              <div class="flex flex-col gap-1">
                <p class="font-semibold text-gray-140 text-sm">Send ICP here to deposit (1 ICP minimum)</p>
                <Copyable class="self-start" before="Principal ID" text={import.meta.env.VITE_BURNER_CANISTER_ID} />
                <Copyable before="Subaccount" text={bytesToHex(mySubaccount()!)} />
              </div>
            </div>
          </Show>
          <div class="flex flex-col items-center gap-2">
            <Btn
              text="Burn"
              class="w-[200px]"
              bgColor={COLORS.orange}
              icon={EIconKind.FlameBW}
              disabled={!canStake()}
              onClick={() => setBurnModalVisible(true)}
            />
            <Show when={canWithdraw()}>
              <p
                class="underline font-normal text-gray-140 cursor-pointer"
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
        <div class="flex justify-between gap-4">
          <Show when={totals.data}>
            <div class="flex flex-col gap-1">
              <BalanceOf
                tokenId={DEFAULT_TOKENS.burn}
                onRefreshOverride={fetchTotals}
                balance={totals.data!.yourUnclaimedReward.toBigIntRaw()}
              />
              <p class="text-sm text-gray-140">Reward per Block: {myBlockCut()?.toString() ?? 0} BURN</p>
              <p class="text-sm text-gray-140">
                Pool Share: {myShare()?.toPercent().toDecimals(4).toString() ?? 0}% (
                {totals.data?.yourShareTcycles?.toString()} / {totals.data?.totalSharesSupply.toString()})
              </p>
            </div>
            <Btn
              text="Claim"
              icon={EIconKind.ArrowUpRight}
              class="w-[200px]"
              bgColor={COLORS.orange}
              iconClass="rotate-180"
              iconColor={COLORS.white}
              disabled={!canClaimReward()}
              onClick={() => setClaimModalVisible(true)}
            />
          </Show>
        </div>
      </div>

      <div class="flex flex-col gap-4">
        <Show fallback={<p class={headerClass}>Burn ICP to Continue</p>} when={totals.data && burnoutLeftoverBlocks()!}>
          <p class={headerClass}>Minting In Progress</p>
          <p>
            Enough fuel for {burnoutLeftoverBlocks()} blocks (approx.{" "}
            {((totals.data!.posRoundDelayNs * BigInt(burnoutLeftoverBlocks()!)) / ONE_MIN_NS).toString()} minutes)
          </p>
          <div class="flex flex-wrap gap-2">
            <For
              fallback={<p class="font-semibold text-xs text-gray-125">Burn ICP to join the pool</p>}
              each={Array(burnoutLeftoverBlocks()!).fill(0)}
            >
              {(_, idx) => (
                <Icon
                  class={idx() === burnoutLeftoverBlocks() - 1 ? "animate-pulse" : undefined}
                  kind={EIconKind.BlockFilled}
                  color={COLORS.orange}
                />
              )}
            </For>
          </div>
        </Show>
      </div>

      <div class="flex flex-col gap-4">
        <p class={headerClass}>Pool Members</p>
        <div class="flex flex-col gap-2">
          <div class="mb-2 grid grid-cols-12 items-center gap-3 text-xs font-semibold text-gray-140">
            <p class="col-span-1"></p>
            <p class="col-span-7">Principal ID</p>
            <p class="col-span-3 text-center">Unclaimed Reward</p>
            <p class="col-span-1">Pool Share</p>
          </div>
          <For each={poolMembers()} fallback={<p class="text-sm text-gray-140">Nothing here yet :(</p>}>
            {(member) => (
              <div class="grid grid-cols-12 items-center gap-3">
                <Avatar
                  class="col-span-1"
                  url={avatarSrcFromPrincipal(member.id)}
                  size="sm"
                  borderColor={COLORS.gray[140]}
                />
                <Copyable class="col-span-7" text={member.id.toText()} />
                <div class="col-span-3 flex justify-center">
                  <BalanceOf tokenId={DEFAULT_TOKENS.burn} balance={member.unclaimedReward.toBigIntRaw()} />
                </div>
                <p class="col-span-1 font-semibold text-gray-140 text-md text-right">
                  <Show when={totals.data && !totals.data.totalSharesSupply.isZero()}>
                    {member.share.div(totals.data!.totalSharesSupply).toPercent().toDecimals(4).toString()}%
                  </Show>
                </p>
              </div>
            )}
          </For>
        </div>
      </div>

      <Switch>
        <Match when={withdrawModalVisible()}>
          <Modal title="Withdraw ICP from Pool" onClose={handleWithdrawModalClose}>
            {withdrawForm}
          </Modal>
        </Match>
        <Match when={burnModalVisible()}>
          <Modal title="Burn ICP in the Pool" onClose={handleBurnModalClose}>
            {burnForm}
          </Modal>
        </Match>
        <Match when={claimModalVisible()}>
          <Modal title="Claim BURN" onClose={handleClaimModalClose}>
            {claimForm}
          </Modal>
        </Match>
      </Switch>
    </Page>
  );
};
