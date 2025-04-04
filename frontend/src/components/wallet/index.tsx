import { BalanceOf } from "@components/balance-of";
import { Btn } from "@components/btn";
import { EIconKind, Icon } from "@components/icon";
import { Modal } from "@components/modal";
import { ProfileMini } from "@components/profile/profile";
import { QtyInput } from "@components/qty-input";
import { TextInput } from "@components/text-input";
import { Principal } from "@dfinity/principal";
import { useAuth } from "@store/auth";
import { DEFAULT_TOKENS, useTokens } from "@store/tokens";
import { useWallet } from "@store/wallet";
import { optUnwrap } from "@utils/backend";
import { COLORS } from "@utils/colors";
import { createLocalStorageSignal } from "@utils/common";
import { logInfo } from "@utils/error";
import { EDs } from "@utils/math";
import { eventHandler } from "@utils/security";
import { Result } from "@utils/types";
import { batch, createEffect, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { Portal } from "solid-js/web";

export type TWalletPage = "index" | "import-token" | "transfer";

export function Wallet() {
  const { pid, poolAccount, bonfireAccount, transfer, savedTokens, isWalletExpanded, setWalletExpanded } = useWallet();
  const { balanceOf, fetchBalanceOf, metadata } = useTokens();

  const [transferringToken, setTransferringToken] = createSignal<Principal>();

  const [walletPage, setWalletPage] = createSignal<TWalletPage>("index");

  const poolBalance = (tokenCanId: Principal) => {
    const a = poolAccount();
    if (!a) return undefined;

    return balanceOf(tokenCanId, a.owner, optUnwrap(a.subaccount) as Uint8Array | undefined);
  };

  createEffect(
    on(poolAccount, (a) => {
      if (!a) return;

      if (poolBalance(DEFAULT_TOKENS.icp) === undefined) {
        fetchBalanceOf(DEFAULT_TOKENS.icp, a.owner, optUnwrap(a.subaccount) as Uint8Array | undefined);
      }
    })
  );

  const bonfireBalance = (tokenCanId: Principal) => {
    const a = bonfireAccount();
    if (!a) return undefined;

    return balanceOf(tokenCanId, a.owner, optUnwrap(a.subaccount) as Uint8Array | undefined);
  };

  createEffect(
    on(bonfireAccount, (a) => {
      if (!a) return;

      for (let token of savedTokens()) {
        if (bonfireBalance(token) === undefined) {
          fetchBalanceOf(token, a.owner, optUnwrap(a.subaccount) as Uint8Array | undefined);
        }
      }
    })
  );

  const handleTransferGoBack = eventHandler(() => {
    setWalletPage("index");
  });

  const handleGoToTransfer = (tokenCanId: Principal) => {
    batch(() => {
      setTransferringToken(tokenCanId);
      setWalletPage("transfer");
    });
  };

  const handleTransfer = async (tokenCanId: Principal, recepient: Principal, qty: bigint) => {
    await transfer(tokenCanId, { owner: recepient, subaccount: [] }, qty);

    setWalletPage("index");
  };

  const handleImportOpen = () => {
    setWalletPage("import-token");
  };

  const handleImportClose = () => {
    setWalletPage("index");
  };

  return (
    <Show when={pid() && poolAccount() && bonfireAccount()}>
      <Portal mount={document.getElementById("wallet-portal")!}>
        <Show when={isWalletExpanded()} fallback={<CollapsedWallet onClick={() => setWalletExpanded(true)} />}>
          <div class="text-white p-6 rounded-3xl flex flex-col gap-6 bg-gray-110 shadow-md shadow-black">
            <Switch>
              <Match when={walletPage() === "index"}>
                <div class="flex flex-row gap-4 items-center justify-between">
                  <div class="flex flex-row gap-2 items-center">
                    <Icon kind={EIconKind.Wallet} color="white" />
                    <p class="font-semibold text-lg">Your Wallet</p>
                  </div>
                  <Icon
                    kind={EIconKind.ChevronDown}
                    color="white"
                    hoverColor={COLORS.gray[140]}
                    onClick={() => setWalletExpanded(false)}
                    class="cursor-pointer"
                  />
                </div>

                <div class="flex">
                  <ProfileMini />
                </div>

                <div
                  class="flex flex-col gap-4 max-h-60 overflow-auto"
                  style={{
                    "scrollbar-color": `${COLORS.gray[140]} transparent`,
                    "scrollbar-width": "thin",
                    "scrollbar-gutter": "stable",
                  }}
                >
                  <For each={savedTokens()}>
                    {(token) => <Token tokenCanId={token} onTrasnferClick={handleGoToTransfer} />}
                  </For>
                </div>

                <p
                  class="flex flex-row gap-2 items-center text-gray-140 justify-end text-xs underline cursor-pointer hover:text-white"
                  onClick={handleImportOpen}
                >
                  Import
                </p>
              </Match>

              <Match when={walletPage() === "transfer"}>
                <div class="flex flex-row gap-2 justify-between items-center">
                  <p
                    class="flex gap-2 items-center text-xs cursor-pointer text-gray-140 hover:text-white underline"
                    onClick={handleTransferGoBack}
                  >
                    <Icon kind={EIconKind.ArrowRight} color="white" size={15} class="rotate-180" /> Back
                  </p>
                  <p class="font-semibold text-lg">Transfer {metadata[transferringToken()!.toText()]!.ticker}</p>
                </div>

                <TransferForm tokenCanId={transferringToken()!} onTransfer={handleTransfer} />
              </Match>

              <Match when={walletPage() === "import-token"}>
                <div class="flex flex-row gap-2 justify-between items-center">
                  <p
                    class="flex gap-2 items-center text-xs cursor-pointer text-gray-140 hover:text-white underline"
                    onClick={handleTransferGoBack}
                  >
                    <Icon kind={EIconKind.ArrowRight} color="white" size={15} class="rotate-180" /> Back
                  </p>
                  <p class="font-semibold text-lg">Import Token</p>
                </div>

                <ImportTokenForm onClose={handleImportClose} />
              </Match>
            </Switch>
          </div>
        </Show>
      </Portal>
    </Show>
  );
}

function Token(props: { tokenCanId: Principal; onTrasnferClick: (tokenCanId: Principal) => void }) {
  const { isReadyToFetch, disabled } = useAuth();
  const { metadata } = useTokens();
  const {
    pid,
    pidBalance,
    bonfireAccount,
    fetchBonfireBalance,
    bonfireBalance,
    poolAccount,
    fetchPoolBalance,
    poolBalance,
    withdrawFromBonfireAccount,
    withdrawIcpFromPoolAccount,
  } = useWallet();

  createEffect(() => {
    if (bonfireAccount() && isReadyToFetch()) {
      fetchBonfireBalance(props.tokenCanId);
    }
  });

  createEffect(() => {
    if (poolAccount() && isReadyToFetch()) {
      fetchPoolBalance(props.tokenCanId);
    }
  });

  const pidTokenBalance = () => pidBalance(props.tokenCanId);
  const bonfireTokenBalance = () => bonfireBalance(props.tokenCanId);
  const poolTokenBalance = () => poolBalance(props.tokenCanId);

  const transferDisabled = () => {
    const b = pidTokenBalance();
    if (!b) return true;

    const m = metadata[props.tokenCanId.toText()];
    if (!m) return true;

    const bEds = EDs.new(b, m.fee.decimals);

    return bEds.le(m.fee);
  };

  const canClaimLost = () => {
    if (disabled()) return false;

    const m = metadata[props.tokenCanId.toText()];
    if (!m) return false;

    const b1 = bonfireTokenBalance();
    if (b1) {
      const b1Eds = EDs.new(b1, m.fee.decimals);
      if (b1Eds.ge(m.fee)) return true;
    }

    if (props.tokenCanId.compareTo(DEFAULT_TOKENS.icp) !== "eq") return false;

    const b2 = poolTokenBalance();
    if (!b2) return false;

    const b2Eds = EDs.new(b2, m.fee.decimals);
    return b2Eds.ge(m.fee);
  };

  const claimLost = eventHandler(() => {
    const m = metadata[props.tokenCanId.toText()];
    if (!m) return;

    const b1 = bonfireTokenBalance();
    if (b1) {
      const b1Eds = EDs.new(b1, m.fee.decimals);
      if (b1Eds.ge(m.fee)) {
        withdrawFromBonfireAccount(props.tokenCanId, b1Eds.sub(m.fee).toBigIntRaw());
      }
    }

    if (props.tokenCanId.compareTo(DEFAULT_TOKENS.icp) !== "eq") return;

    const b2 = poolTokenBalance();
    if (!b2) return;

    const b2Eds = EDs.new(b2, m.fee.decimals);
    if (b2Eds.ge(m.fee)) {
      withdrawIcpFromPoolAccount(b2Eds.sub(m.fee).toBigIntRaw());
    }
  });

  return (
    <div class="flex gap-4 items-center justify-between">
      <BalanceOf tokenId={props.tokenCanId} owner={pid()!} />
      <div class="flex items-center gap-1">
        <Show when={canClaimLost()}>
          <div class="flex gap-4 items-center justify-between">
            <p class="text-xs text-gray-140 italic underline cursor-pointer" onClick={claimLost}>
              Claim Lost
            </p>
          </div>
        </Show>

        <Icon
          kind={EIconKind.ArrowUpRight}
          color="white"
          hoverColor={transferDisabled() ? COLORS.gray[150] : COLORS.chartreuse}
          onClick={() => props.onTrasnferClick(props.tokenCanId)}
          disabled={transferDisabled()}
          class={transferDisabled() ? "" : "cursor-pointer"}
        />
      </div>
    </div>
  );
}

function CollapsedWallet(props: { onClick: () => void }) {
  return (
    <div
      onClick={props.onClick}
      class="fixed z-60 cursor-pointer px-6 py-4 rounded-tl-[24px] rounded-tr-[24px] rotate-0 sm:-rotate-90 bottom-0 left-0 right-0 sm:bottom-[100px] sm:right-[-80px] sm:left-auto w-full sm:w-auto flex flex-col justify-center items-center bg-chartreuse shadow-md shadow-black"
    >
      <div class="flex flex-row gap-4 items-center">
        <Icon kind={EIconKind.Wallet} />
        <div class="flex flex-row gap-2 items-center">
          <p class="font-semibold text-lg">Your Wallet</p>
          <Icon kind={EIconKind.ChevronUp} />
        </div>
      </div>
    </div>
  );
}

interface ITransferFormProps {
  tokenCanId: Principal;

  onTransfer: (tokenCanId: Principal, recepient: Principal, qty: bigint) => Promise<void>;
}

function TransferForm(props: ITransferFormProps) {
  const { pidBalance } = useWallet();
  const { metadata } = useTokens();

  const meta = () => metadata[props.tokenCanId.toText()];

  const [transferRecepient, setTransferRecepient] = createSignal<Result<string>>(Result.Err(""));
  const [transferQty, setTransferQty] = createSignal<Result<EDs, string>>(Result.Err(""));

  const canTransfer = () => {
    return meta() && pidBalance(props.tokenCanId) && transferQty().isOk() && transferRecepient().isOk();
  };

  const handleTransfer = async () => {
    const recepient = Principal.fromText(transferRecepient().unwrapOk());
    const qty = transferQty().unwrapOk();

    await props.onTransfer(props.tokenCanId, recepient, qty.val);

    logInfo(`Successfully trasnferred ${qty.toString()} ${meta()!.ticker}`);
  };

  return (
    <div class="flex flex-col gap-8">
      <div class="flex flex-col gap-4">
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
            value={transferRecepient().unwrap()}
            onChange={setTransferRecepient}
          />
        </div>

        <div class="flex flex-col gap-2">
          <p class="font-semibold text-sm text-gray-140">
            Amount <span class="text-errorRed">*</span>
          </p>
          <QtyInput
            value={transferQty()}
            onChange={setTransferQty}
            decimals={meta()!.fee.decimals}
            fee={meta()!.fee}
            validations={[
              { required: null },
              {
                min: meta()!.fee,
                max: EDs.new(pidBalance(props.tokenCanId) || meta()!.fee.val, meta()!.fee.decimals),
              },
            ]}
            symbol={meta()!.ticker}
            placeholder={`Max is ${EDs.new(pidBalance(props.tokenCanId) || meta()!.fee.val, meta()!.fee.decimals)}`}
          />
        </div>
      </div>

      <Btn
        text="Confirm"
        class="font-semibold"
        bgColor={COLORS.orange}
        disabled={!canTransfer()}
        onClick={handleTransfer}
      />
    </div>
  );
}

export function ImportTokenForm(props: { onClose: () => void }) {
  const { metadata, fetchMetadata } = useTokens();
  const { savedTokens, addSavedToken } = useWallet();

  const [tokenCanId, setTokenCanId] = createSignal<Result<string>>(Result.Err(""));
  const [fetchingMetadata, setFetchingMetadata] = createSignal(false);

  createEffect(
    on(tokenCanId, (canId) => {
      if (canId.isOk()) {
        const meta = metadata[canId.unwrapOk()];

        if (!meta) {
          setFetchingMetadata(true);
          fetchMetadata(Principal.fromText(canId.unwrapOk())).then(() => setFetchingMetadata(false));
        }
      }
    })
  );

  const btnText = () => {
    const idRes = tokenCanId();
    if (idRes.isErr()) return "Type Canister ID";

    const id = idRes.unwrapOk();

    const found = savedTokens().find((it) => it.toText() === id);
    if (found) return "Already imported";

    if (fetchingMetadata()) return "Stand by...";

    const meta = metadata[id];
    if (!meta) return "Invalid ICRC-1 Token";

    return `Import ${meta.ticker}`;
  };

  const btnDisabled = () => {
    const idRes = tokenCanId();
    if (idRes.isErr()) return true;

    const id = idRes.unwrapOk();

    const found = savedTokens().find((it) => it.toText() === id);
    if (found) return true;

    if (fetchingMetadata()) return true;

    const meta = metadata[id];
    if (!meta) return true;

    return false;
  };

  const handleImport = () => {
    const id = Principal.fromText(tokenCanId().unwrapOk());

    addSavedToken(id);
    props.onClose();
  };

  return (
    <div class="flex flex-col gap-8">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <p class="font-semibold text-sm text-gray-140">
            Token Canister ID <span class="text-errorRed">*</span>
          </p>
          <TextInput
            placeholder={import.meta.env.VITE_BURNER_CANISTER_ID}
            validations={[{ principal: null }, { required: null }]}
            value={tokenCanId().unwrap()}
            onChange={setTokenCanId}
          />
        </div>
      </div>

      <Btn
        text={btnText()}
        class="font-semibold"
        bgColor={COLORS.orange}
        disabled={btnDisabled()}
        onClick={handleImport}
      />
    </div>
  );
}
