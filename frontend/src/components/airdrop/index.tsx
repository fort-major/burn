import { BalanceOf } from "@components/balance-of";
import { Bento } from "@components/bento";
import { Btn } from "@components/btn";
import { Copyable } from "@components/copyable";
import { Principal } from "@dfinity/principal";
import { useAuth } from "@store/auth";
import { useDispensers } from "@store/dispensers";
import { useTokens } from "@store/tokens";
import { useWallet } from "@store/wallet";
import { COLORS } from "@utils/colors";
import { createEffect, on, onMount, Show } from "solid-js";

export interface IAirdropProps {
  dispenserCanId: Principal;
  tokenCanId: Principal;
}

export function Airdrop(props: IAirdropProps) {
  const { isAuthorized } = useAuth();
  const { dispenserUnclaimedTokens, fetchDispenserUnclaimedTokens, claimDispenserUnclaimedTokens } = useDispensers();
  const { pid } = useWallet();
  const { metadata, fetchMetadata } = useTokens();

  const unclaimed = () => dispenserUnclaimedTokens[props.dispenserCanId.toText()];
  const meta = () => metadata[props.tokenCanId.toText()];

  onMount(() => {
    if (isAuthorized() && !unclaimed()) {
      fetchDispenserUnclaimedTokens(props.dispenserCanId);
    }
  });

  createEffect(
    on(isAuthorized, (ready) => {
      if (ready && !unclaimed()) {
        fetchDispenserUnclaimedTokens(props.dispenserCanId);
      }
    })
  );

  const canClaim = () => {
    const u = unclaimed();
    if (!u) return false;

    return !u.isZero();
  };

  const handleClaimClick = async () => {
    const u = unclaimed()!;

    await claimDispenserUnclaimedTokens(props.dispenserCanId, u);
    fetchDispenserUnclaimedTokens(props.dispenserCanId);
  };

  return (
    <Bento id={4} class="flex-col">
      <div class="flex items-center gap-2">
        <Show when={meta()} fallback={<Copyable text={props.tokenCanId.toText()} ellipsis ellipsisSymbols={20} />}>
          <p class="font-semibold">{meta()!.name}</p>
        </Show>
      </div>
      <BalanceOf
        balance={unclaimed() ? unclaimed()!.toBigIntRaw() : 0n}
        tokenId={props.tokenCanId}
        onRefreshOverride={() => fetchDispenserUnclaimedTokens(props.dispenserCanId)}
      />
      <Btn
        text={`Claim${meta() ? ` $${meta()!.ticker}` : ""}`}
        disabled={!canClaim()}
        onClick={handleClaimClick}
        bgColor={COLORS.orange}
        class="font-semibold"
      />
    </Bento>
  );
}
