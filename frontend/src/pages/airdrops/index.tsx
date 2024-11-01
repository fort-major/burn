import { ROOT } from "@/routes";
import { Airdrop } from "@components/airdrop";
import { EIconKind, Icon } from "@components/icon";
import { Page } from "@components/page";
import { Principal } from "@dfinity/principal";
import { A } from "@solidjs/router";
import { useAuth } from "@store/auth";
import { useDispensers } from "@store/dispensers";
import { COLORS } from "@utils/colors";
import { createMemo, For, Show } from "solid-js";

export function AirdropsPage() {
  const { isAuthorized } = useAuth();
  const { dispenserIdByTokenId } = useDispensers();

  const dispenserIdsList = createMemo(() =>
    Object.entries(dispenserIdByTokenId).map(([t, d]) => [Principal.fromText(t), d] as [Principal, Principal])
  );

  return (
    <Page slim>
      <div class="flex flex-col gap-6">
        <h1 class="font-semibold text-4xl">Create an Airdrop</h1>
        <div class="flex flex-col gap-4 sm:flex-row justify-between">
          <div class="flex flex-col gap-2 text-gray-140 text-sm max-w-[500px]">
            <p>
              Looking for a way to fairly distribute tokens? Want to motivate Bonfire participants to burn tokens of
              your project or just feeling generous?
            </p>
          </div>
          <Show when={isAuthorized()} fallback={<p class="text-orange">Sign In To Continue</p>}>
            <A
              class="sm:self-start p-4 rounded-3xl bg-orange text-white font-semibold flex items-center justify-center gap-2"
              href={ROOT.$.airdrops.$.create.path}
            >
              Start Distributing <Icon kind={EIconKind.ArrowRight} color={COLORS.white} />
            </A>
          </Show>
        </div>
      </div>

      <div class="flex flex-col gap-6">
        <p class="font-semibold text-4xl">Running Airdrop Machines</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <For each={dispenserIdsList()}>{([t, d]) => <Airdrop tokenCanId={t} dispenserCanId={d} />}</For>
        </div>
      </div>
    </Page>
  );
}
