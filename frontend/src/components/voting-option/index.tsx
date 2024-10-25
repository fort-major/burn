import { Bento } from "@components/bento";
import { EIconKind, Icon } from "@components/icon";
import { Principal } from "@dfinity/principal";
import { useAuth } from "@store/auth";
import { useFurnace } from "@store/furnace";
import { useTokens } from "@store/tokens";
import { COLORS } from "@utils/colors";
import { E8s } from "@utils/math";
import { createEffect, createSignal, on, Show } from "solid-js";

export interface ITokenVotingOptionProps {
  id: number;
  tokenCanId: Principal;
}

export function TokenVotingOption(props: ITokenVotingOptionProps) {
  const { isAuthorized, disabled } = useAuth();
  const { metadata, fetchMetadata } = useTokens();
  const {
    tokenXVotingAlternatives,
    voteTokenX,
    myShares,
    myVoteTokenX,
    info,
    fetchMyVoteTokenX,
    fetchTokenXVotingAlternatives,
  } = useFurnace();

  const [tickerImg, setTickerImg] = createSignal<string>();
  const [tickerImgIsPortrait, setTickerImgIsPortrait] = createSignal(false);

  let canvasRef: HTMLCanvasElement | undefined = undefined;

  const meta = () => metadata[props.tokenCanId.toText()];
  const votes = () =>
    tokenXVotingAlternatives().find((it) => it.tokenCanisterId.compareTo(props.tokenCanId) === "eq")?.votes;

  const votesShare = () => {
    const v = votes();
    if (!v) return E8s.zero();

    const i = info();
    if (!i) return E8s.zero();

    return v.div(i.curRoundPledgedBurnUsd);
  };

  const canVote = () => {
    if (!isAuthorized()) return false;

    const shares = myShares();
    if (!shares || shares.votingPower.isZero()) return false;

    return true;
  };

  const vote = async () => {
    await voteTokenX([{ tokenCanisterId: props.tokenCanId, normalizedWeight: E8s.one() }]);

    fetchMyVoteTokenX();
    fetchTokenXVotingAlternatives();
  };

  const votedForThisToken = () => {
    const myVote = myVoteTokenX();
    if (!myVote) return false;

    const found = myVote.find((it) => it.tokenCanisterId.compareTo(props.tokenCanId) === "eq");

    return !!found;
  };

  createEffect(
    on(meta, (m) => {
      if (!m) {
        fetchMetadata(props.tokenCanId);
      }
    })
  );

  createEffect(() => {
    const m = meta();
    if (!m || !canvasRef) return;

    const res = textToImg(m.ticker, canvasRef);
    if (!res) return;

    const { src, w, h } = res;

    setTickerImg(src);
    setTickerImgIsPortrait(h > w);
  });

  return (
    <Bento class="relative flex-col gap-6 overflow-hidden col-span-2 sm:col-span-1" id={props.id % 5}>
      <Show when={meta()}>
        <canvas ref={canvasRef} class="hidden"></canvas>

        <div class="absolute top-0 left-0 right-0 h-full">
          <img
            class="relative opacity-[0.03]"
            classList={{ "h-full": !tickerImgIsPortrait(), "w-full": tickerImgIsPortrait() }}
            src={tickerImg()}
          />
        </div>

        <div
          class="absolute bottom-0 left-0 right-0 w-full bg-chartreuse opacity-5"
          style={{ height: `${votesShare()?.toPercentNum() || 0}%` }}
        ></div>

        <div class="relative flex flex-col gap-2">
          <div class="flex items-center gap-4">
            <img src={meta()!.logoSrc} class="w-10 h-10 rounded-full" />
            <p class="font-semibold text-2xl">{meta()!.name}</p>
          </div>
        </div>

        <div class="relative flex items-center justify-between">
          <p class="font-bold text-4xl">
            {votesShare()?.toPercent().toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 0 })}%
          </p>
          <Show when={canVote() && (!myVoteTokenX() || votedForThisToken())}>
            <Icon
              kind={EIconKind.ThumbUp}
              color={votedForThisToken() ? COLORS.chartreuse : COLORS.gray[140]}
              hoverColor={COLORS.chartreuse}
              disabled={disabled()}
              class={myVoteTokenX() ? undefined : "cursor-pointer"}
              onClick={myVoteTokenX() ? undefined : vote}
            />
          </Show>
        </div>
      </Show>
    </Bento>
  );
}

function textToImg(text: string, canvas?: HTMLCanvasElement): { src: string; w: number; h: number } | undefined {
  if (!canvas) return undefined;

  const tCtx = canvas.getContext("2d");
  if (!tCtx) return undefined;

  tCtx.font = "bold 500px DM Sans";
  tCtx.fillStyle = "white";

  const measurements = tCtx.measureText(text);
  canvas.width = measurements.actualBoundingBoxLeft + measurements.actualBoundingBoxRight;
  canvas.height = measurements.actualBoundingBoxAscent + measurements.actualBoundingBoxDescent;

  tCtx.font = "bold 500px DM Sans";
  tCtx.fillStyle = "white";

  tCtx.fillText(text, canvas.width * -0.02, canvas.height * 0.98);

  return { src: tCtx.canvas.toDataURL(), w: canvas.width, h: canvas.height };
}
