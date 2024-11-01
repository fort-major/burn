import { ROOT } from "@/routes";
import { Backlink } from "@components/backlink";
import { Bento } from "@components/bento";
import { BooleanInput } from "@components/boolean-input";
import { Btn } from "@components/btn";
import { Copyable } from "@components/copyable";
import { EIconKind, Icon } from "@components/icon";
import { Multiswitch } from "@components/multiswitch";
import { Page } from "@components/page";
import { QtyInput } from "@components/qty-input";
import { Select } from "@components/select";
import { Slider } from "@components/slider";
import { TextInput } from "@components/text-input";
import { Principal } from "@dfinity/principal";
import { useNavigate } from "@solidjs/router";
import { useAuth } from "@store/auth";
import { TDistributionTrigger, useDispensers } from "@store/dispensers";
import { useFurnace } from "@store/furnace";
import { DEFAULT_TOKENS, useTokens } from "@store/tokens";
import { useWallet } from "@store/wallet";
import { COLORS } from "@utils/colors";
import { tokensToStr } from "@utils/encoding";
import { logInfo } from "@utils/error";
import { EDs } from "@utils/math";
import { eventHandler } from "@utils/security";
import { Result } from "@utils/types";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";

export type TPageState = "TokenSelection" | "DistributionCreation" | "Complete";
export type TStartConditionKind = "Time" | "Event";
export type TTriggerKind = "OnTotalPledged" | "OnTokenX";

export function CreateAirdropPage() {
  const { isAuthorized } = useAuth();
  const { savedTokens, pidBalance } = useWallet();
  const { metadata, fetchMetadata } = useTokens();
  const {
    dispenserIdByTokenId,
    fetchDispenserIds,
    canCreateDispenser,
    createDispenser,
    createDistribution,
    createDistributionTrigger,
  } = useDispensers();
  const { supportedTokens, getTotalTokensPledged } = useFurnace();
  const navigate = useNavigate();

  const [pageState, setPageState] = createSignal<TPageState>("TokenSelection");
  const [selectedToken, setSelectedToken] = createSignal<Principal>();
  const [selectedDispenser, setSelectedDispenser] = createSignal<Principal>();
  const [loading, setLoading] = createSignal<boolean>();
  const [startConditionKind, setStartConditionKind] = createSignal<TStartConditionKind>("Time");
  const [triggerKind, setTriggerKind] = createSignal<TTriggerKind>("OnTotalPledged");
  const [triggerToken, setTriggerToken] = createSignal<Principal>();
  const [triggerAmount, setTriggerAmount] = createSignal<Result<EDs, string>>(Result.Err(""));
  const [distributionName, setDistributionName] = createSignal<Result<string>>(Result.Err(""));
  const [durationTicks, setDurationTicks] = createSignal(168);
  const [hidden, setHidden] = createSignal(false);
  const [distributionAmount, setDistributionAmount] = createSignal<Result<EDs, string>>(Result.Err(""));
  const [delayTicks, setDelayTicks] = createSignal(168);

  const meta = (tokenCanId: Principal) => metadata[tokenCanId.toText()];

  const handleSetDurationTicks = (val: number) => {
    switch (val) {
      case 0: {
        setDurationTicks(1);
        return;
      }
      case 1: {
        setDurationTicks(24);
        return;
      }
      case 2: {
        setDurationTicks(24 * 7);
        return;
      }
      case 3: {
        setDurationTicks(24 * 7 * 2);
        return;
      }
      case 4: {
        setDurationTicks(24 * 7 * 3);
        return;
      }
      case 5: {
        setDurationTicks(720);
        return;
      }
    }
  };

  const handleSetDelayTicks = (val: number) => {
    switch (val) {
      case 0: {
        setDelayTicks(0);
        return;
      }
      case 1: {
        setDelayTicks(24);
        return;
      }
      case 2: {
        setDelayTicks(24 * 7);
        return;
      }
      case 3: {
        setDelayTicks(24 * 7 * 2);
        return;
      }
      case 4: {
        setDelayTicks(24 * 7 * 3);
        return;
      }
      case 5: {
        setDelayTicks(720);
        return;
      }
    }
  };

  createEffect(
    on(supportedTokens, (tokens) => {
      if (tokens.length > 0 && !triggerToken()) {
        setTriggerToken(tokens[0]);
      }

      for (let t of tokens) {
        const m = meta(t);
        if (m) continue;

        fetchMetadata(t);
      }
    })
  );

  createEffect(
    on(selectedToken, async (token) => {
      if (!token) {
        setSelectedDispenser(undefined);
        return;
      }

      let dispenser = dispenserIdByTokenId[token.toText()];
      if (dispenser) {
        setSelectedDispenser(dispenser);
        return;
      }

      setLoading(true);
      await fetchDispenserIds();
      setLoading(false);

      dispenser = dispenserIdByTokenId[token.toText()];
      if (dispenser) {
        setSelectedDispenser(dispenser);
        return;
      }

      setSelectedDispenser(undefined);
    })
  );

  const handleSelectToken = (tokenCanId: Principal) => {
    setSelectedToken((t) => {
      if (!t) return tokenCanId;
      if (t.compareTo(tokenCanId) === "eq") return undefined;

      return tokenCanId;
    });
  };

  const handleCreateDispenser = async (tokenCanId: Principal) => {
    await createDispenser(tokenCanId);

    let dispenser = dispenserIdByTokenId[tokenCanId.toText()];

    setSelectedDispenser(dispenser!);
  };

  const handleToDistributionCreation = () => {
    setPageState("DistributionCreation");
  };

  const canCreateDistribution = () => {
    if (!isAuthorized()) return false;

    const icp = pidBalance(DEFAULT_TOKENS.icp);
    if (!icp || icp < 1_0000_0000n) return false;

    const tokenToDistribute = selectedToken();
    if (!tokenToDistribute) return false;

    const dispenserToDistribute = selectedDispenser();
    if (!dispenserToDistribute) return false;

    const name = distributionName();
    if (name.isErr()) return false;

    const amountToDistribute = distributionAmount();
    if (amountToDistribute.isErr()) return false;

    const tok = pidBalance(tokenToDistribute);
    if (!tok) return false;

    const qty = amountToDistribute.unwrapOk();
    if (EDs.new(tok, qty.decimals).le(qty)) return false;

    const startCondition = startConditionKind();

    if (startCondition === "Time") {
      return true;
    }

    // start condition = event
    const ekind = triggerKind();
    const t = triggerToken();
    if (!t) return false;

    if (ekind === "OnTokenX") {
      return true;
    }

    // ekind = on pledged
    const amt = triggerAmount();
    if (amt.isErr()) return false;

    return true;
  };

  const handleCreateDistribution = async () => {
    const tokenToDistribute = selectedToken()!;
    const name = distributionName().unwrapOk();
    const isHidden = hidden();
    const duration = BigInt(durationTicks());
    const amountToDistribute = distributionAmount().unwrapOk();
    const startCondition = startConditionKind();

    if (startCondition === "Time") {
      const d = BigInt(delayTicks());
      await createDistribution(tokenToDistribute, amountToDistribute.val, name, duration, d, isHidden);

      logInfo("Success! Redirecting you back...");
      navigate(ROOT.$.airdrops.$["/"].path);

      return;
    }

    const id = await createDistribution(tokenToDistribute, amountToDistribute.val, name, duration, undefined, isHidden);

    const ekind = triggerKind();
    const tokenToBurn = triggerToken()!;

    let trigger: TDistributionTrigger | undefined = undefined;

    if (ekind === "OnTokenX") {
      trigger = { TokenXVotingWinner: tokenToBurn };
    } else {
      const amt = triggerAmount().unwrapOk();
      trigger = {
        TokenTotalPledged: { token_can_id: tokenToBurn, threshold: amt.val },
      };
    }

    await createDistributionTrigger(tokenToDistribute, id, trigger);

    logInfo("Success! Redirecting you back...");

    navigate(ROOT.$.airdrops.$["/"].path);
  };

  return (
    <Page slim class="sm:pb-20">
      <Backlink />
      <h2 class="font-semibold text-6xl">Start an Airdrop</h2>

      <div class="flex flex-col gap-10">
        <Switch>
          <Match when={pageState() === "TokenSelection"}>
            <h4 class="font-semibold text-xl">Select a Token to Distribute</h4>

            <div class="flex flex-col gap-4">
              <div class="flex flex-col gap-2">
                <For each={savedTokens()}>
                  {(tokenCanId) => (
                    <Show
                      when={meta(tokenCanId)}
                      fallback={<Copyable text={tokenCanId.toText()} ellipsis ellipsisSymbols={20} />}
                    >
                      {(m) => (
                        <div
                          class="flex p-4 rounded-3xl justify-between items-center hover:bg-gray-120 cursor-pointer"
                          onClick={eventHandler((_) => handleSelectToken(tokenCanId))}
                          classList={{
                            "bg-gray-120": selectedToken()?.compareTo(tokenCanId) === "eq",
                            "bg-gray-108": selectedToken()?.compareTo(tokenCanId) !== "eq",
                          }}
                        >
                          <div class="flex items-center gap-2">
                            <img src={m().logoSrc} class="h-5 w-5 rounded-full" />
                            <p class="font-semibold text-lg">{m().name}</p>
                            <Copyable text={tokenCanId.toText()} ellipsis ellipsisSymbols={4} />
                          </div>

                          <div class="flex items-center gap-1">
                            <p class="text-gray-140">{m().ticker}</p>
                          </div>
                        </div>
                      )}
                    </Show>
                  )}
                </For>
              </div>
              <p class="text-xs text-right font-semibold text-gray-140">
                Import the token to your wallet to see it here
              </p>
            </div>

            <Show when={selectedToken()}>
              <Switch>
                <Match when={selectedDispenser()}>
                  <div class="flex flex-col gap-4 sm:flex-row items-center justify-between">
                    <div class="flex items-center gap-2">
                      <p class="text-gray-140">Airdrop Machine</p>
                      <Copyable text={selectedDispenser()!.toText()} ellipsis ellipsisSymbols={20} />
                    </div>
                    <Btn
                      text="Continue"
                      class="font-semibold self-stretch sm:self-start"
                      bgColor={COLORS.orange}
                      onClick={handleToDistributionCreation}
                    />
                  </div>
                </Match>
                <Match when={!selectedDispenser() && loading()}>
                  <div class="flex items-center gap-2">
                    <Icon color={COLORS.gray[140]} kind={EIconKind.DotsCircle} />
                    <p class="text-gray-140">Please stand by...</p>
                  </div>
                </Match>
                <Match when={!selectedDispenser() && !loading()}>
                  <div class="flex flex-col gap-2">
                    <p class="text-gray-140">Airdrop Machine Not Found</p>
                    <Btn
                      text="Create Airdrop Machine (1 ICP)"
                      bgColor={COLORS.orange}
                      class="font-semibold"
                      disabled={!canCreateDispenser(selectedToken()!)}
                      onClick={() => handleCreateDispenser(selectedToken()!)}
                    />
                  </div>
                </Match>
              </Switch>
            </Show>
          </Match>
          <Match when={pageState() === "DistributionCreation"}>
            <h4 class="font-semibold text-xl">Set Parameters ({meta(selectedToken()!)?.ticker})</h4>

            <div class="flex flex-col gap-10">
              <div class="flex flex-col gap-2">
                <div class="flex flex-col gap-1">
                  <p class="font-semibold text-md">
                    Distribution Name <span class="text-errorRed">*</span>
                  </p>
                  <p class="text-gray-140 text-xs">
                    Let your future token holders know whom to thank or just write something cool.
                  </p>
                  <TextInput
                    value={distributionName().unwrap()}
                    onChange={setDistributionName}
                    validations={[{ minLen: 4, maxLen: 100 }, { required: null }]}
                    placeholder="Acme Team | Coolest Airdrop Ever"
                  />
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div class="flex flex-col gap-2">
                  <div class="flex flex-col gap-1">
                    <p class="font-semibold text-md">Duration</p>
                    <p class="text-gray-140 text-xs">Airdrop machine distributes tokens gradually each hour.</p>
                    <div class="flex items-end justify-between gap-4 py-3">
                      <Multiswitch
                        defaultIdx={2}
                        states={["One Hour", "One Day", "One Week", "Two Weeks", "Three Weeks", "One Month"]}
                        onChange={handleSetDurationTicks}
                      />
                    </div>
                  </div>
                </div>

                <div class="flex flex-col gap-2">
                  <div class="flex flex-col gap-1">
                    <p class="font-semibold text-md">Mystery Box Mode</p>
                    <p class="text-gray-140 text-xs">
                      You can hide the amount from others, until the distribution starts. This adds mystery to the
                      process.
                    </p>
                    <BooleanInput labelOn="Hide Amount" labelOff="Hide Amount" value={hidden()} onChange={setHidden} />
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div class="flex flex-col gap-2">
                  <div class="flex flex-col gap-1">
                    <p class="font-semibold text-md">
                      Total Amount to Distribute <span class="text-errorRed">*</span>
                    </p>
                    <p class="text-gray-140 text-xs">
                      You will have to provide the whole amount at once. Remember, you can always airdrop more later.
                    </p>
                    <Show
                      when={selectedToken() && meta(selectedToken()!) && pidBalance(selectedToken()!) !== undefined}
                    >
                      <QtyInput
                        value={distributionAmount()}
                        onChange={setDistributionAmount}
                        symbol={meta(selectedToken()!)!.ticker}
                        decimals={meta(selectedToken()!)!.fee.decimals}
                        fee={meta(selectedToken()!)?.fee}
                        validations={[
                          { min: meta(selectedToken()!)!.fee },
                          {
                            max: EDs.new(pidBalance(selectedToken()!)!, meta(selectedToken()!)!.fee.decimals),
                          },
                          { required: null },
                        ]}
                      />
                    </Show>
                  </div>
                </div>
              </div>

              <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                  <p class="font-semibold text-xl">Start Condition</p>
                  <p class="text-gray-140 text-xs">
                    The distribution can start immediately, after a delay or when something else happens in this dapp.
                  </p>
                </div>

                <div class="grid grid-cols-2 gap-4">
                  <div
                    class="flex p-4 gap-2 rounded-3xl items-center hover:bg-orange cursor-pointer"
                    onClick={eventHandler((_) => {
                      setStartConditionKind("Time");
                    })}
                    classList={{
                      "bg-orange": startConditionKind() === "Time",
                      "bg-gray-108": startConditionKind() === "Event",
                    }}
                  >
                    <Icon kind={EIconKind.Time} color={COLORS.white} />
                    <p class="font-semibold">Time Driven Start</p>
                  </div>
                  <div
                    class="flex p-4 gap-2 rounded-3xl items-center hover:bg-orange cursor-pointer"
                    onClick={eventHandler((_) => {
                      setStartConditionKind("Event");
                    })}
                    classList={{
                      "bg-orange": startConditionKind() === "Event",
                      "bg-gray-108": startConditionKind() === "Time",
                    }}
                  >
                    <Icon kind={EIconKind.LightningCircle} color={COLORS.white} />
                    <p class="font-semibold">Event Driven Start</p>
                  </div>
                </div>

                <Switch>
                  <Match when={startConditionKind() === "Time"}>
                    <div class="flex flex-col gap-1">
                      <p class="font-semibold text-md">Start Delay</p>
                      <p class="text-gray-140 text-xs">
                        You will be able to cancel your distribution while there are at least 3 ticks left before it's
                        start.
                      </p>
                      <div class="flex items-end justify-between gap-4 py-3">
                        <Multiswitch
                          defaultIdx={2}
                          states={["One Hour", "One Day", "One Week", "Two Weeks", "Three Weeks", "One Month"]}
                          onChange={handleSetDelayTicks}
                        />
                      </div>
                    </div>
                  </Match>
                  <Match when={startConditionKind() === "Event"}>
                    <div class="flex flex-col gap-4">
                      <div class="flex gap-4">
                        <div
                          class="flex py-2 px-4 gap-2 font-semibold text-sm rounded-3xl items-center hover:bg-orange cursor-pointer"
                          onClick={eventHandler((_) => {
                            setTriggerKind("OnTotalPledged");
                          })}
                          classList={{
                            "bg-orange": triggerKind() === "OnTotalPledged",
                            "bg-gray-108": triggerKind() === "OnTokenX",
                          }}
                        >
                          <Icon kind={EIconKind.LightningCircle} size={18} color={COLORS.white} />
                          <p>On Total Pledged</p>
                        </div>
                        <div
                          class="flex py-2 px-4 gap-2 font-semibold text-sm rounded-3xl items-center hover:bg-orange cursor-pointer"
                          onClick={eventHandler((_) => {
                            setTriggerKind("OnTokenX");
                          })}
                          classList={{
                            "bg-orange": triggerKind() === "OnTokenX",
                            "bg-gray-108": triggerKind() === "OnTotalPledged",
                          }}
                        >
                          <Icon kind={EIconKind.LightningCircle} size={18} color={COLORS.white} />
                          <p>On Next Week's Token Elected</p>
                        </div>
                      </div>

                      <Switch>
                        <Match when={triggerKind() === "OnTotalPledged"}>
                          <p class="font-semibold text-xs text-gray-140">
                            Triggers when Bonfire participants pledge a certain amount of a certain token. Carries
                            through rounds.
                          </p>

                          <div class="flex flex-col gap-2">
                            <div class="flex flex-col gap-1">
                              <p class="font-semibold text-md">
                                Pledged Token <span class="text-errorRed">*</span>
                              </p>
                              <p class="text-gray-140 text-xs">
                                To get your airdrop the participants whould have to pledge this token.
                              </p>
                            </div>

                            <div class="flex flex-wrap gap-4">
                              <For each={supportedTokens()}>
                                {(token) => {
                                  const m = meta(token);

                                  return (
                                    <div
                                      class="flex px-4 py-2 justify-center items-center rounded-full cursor-pointer hover:bg-orange"
                                      classList={{
                                        "bg-gray-108": triggerToken()?.compareTo(token) !== "eq",
                                        "bg-orange": triggerToken()?.compareTo(token) === "eq",
                                      }}
                                      onClick={eventHandler((_) => {
                                        setTriggerToken(token);
                                      })}
                                    >
                                      <Show when={m} fallback={token.toText()}>
                                        <div class="flex items-center gap-2">
                                          <img src={m!.logoSrc} class="w-5 h-5 rounded-full" />
                                          <p class="font-semibold text-sm">{m!.name}</p>
                                        </div>
                                      </Show>
                                    </div>
                                  );
                                }}
                              </For>
                            </div>
                          </div>

                          <div class="flex flex-col gap-2">
                            <div class="flex flex-col gap-1">
                              <p class="font-semibold text-md">
                                Amount To Pledge <span class="text-errorRed">*</span>
                              </p>
                              <p class="text-gray-140 text-xs">
                                And they whould have to pledge at least this amount in total.{" "}
                                <Show when={triggerToken()}>
                                  Currently pledged {getTotalTokensPledged(triggerToken()!).toString()}{" "}
                                  {meta(triggerToken()!)?.ticker}
                                </Show>
                                .
                              </p>
                              <QtyInput
                                value={triggerAmount()}
                                onChange={setTriggerAmount}
                                symbol={meta(triggerToken()!)!.ticker}
                                decimals={meta(triggerToken()!)!.fee.decimals}
                                fee={meta(triggerToken()!)?.fee}
                                validations={[
                                  {
                                    min: meta(triggerToken()!)!.fee.add(
                                      getTotalTokensPledged(triggerToken()!).toDecimals(
                                        meta(triggerToken()!)!.fee.decimals
                                      )
                                    ),
                                  },
                                  { required: null },
                                ]}
                              />
                            </div>
                          </div>
                        </Match>
                        <Match when={triggerKind() === "OnTokenX"}>
                          <p class="font-semibold text-xs text-gray-140">
                            Triggers when Bonfire participants elect a certain token to burn during the next week.
                            Carries through rounds.
                          </p>

                          <div class="flex flex-col gap-2">
                            <div class="flex flex-col gap-1">
                              <p class="font-semibold text-md">
                                Elected Token <span class="text-errorRed">*</span>
                              </p>
                              <p class="text-gray-140 text-xs">
                                To get your airdrop the participants whould have to elect this token.
                              </p>
                            </div>

                            <div class="flex flex-wrap gap-4">
                              <For each={supportedTokens()}>
                                {(token) => {
                                  const m = meta(token);

                                  return (
                                    <div
                                      class="flex px-4 py-2 justify-center items-center rounded-full cursor-pointer hover:bg-orange"
                                      classList={{
                                        "bg-gray-108": triggerToken()?.compareTo(token) !== "eq",
                                        "bg-orange": triggerToken()?.compareTo(token) === "eq",
                                      }}
                                      onClick={eventHandler((_) => {
                                        setTriggerToken(token);
                                      })}
                                    >
                                      <Show when={m} fallback={token.toText()}>
                                        <div class="flex items-center gap-2">
                                          <img src={m!.logoSrc} class="w-5 h-5 rounded-full" />
                                          <p class="font-semibold text-sm">{m!.name}</p>
                                        </div>
                                      </Show>
                                    </div>
                                  );
                                }}
                              </For>
                            </div>
                          </div>
                        </Match>
                      </Switch>
                    </div>
                  </Match>
                </Switch>
              </div>

              <Btn
                text="Create Distribution (1 ICP)"
                class="font-semibold"
                bgColor={COLORS.orange}
                disabled={!canCreateDistribution()}
                onClick={handleCreateDistribution}
              />
            </div>
          </Match>
        </Switch>
      </div>
    </Page>
  );
}
