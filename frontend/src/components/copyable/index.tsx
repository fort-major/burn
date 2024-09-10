import { EIconKind, Icon } from "@components/icon";
import { COLORS } from "@utils/colors";
import { eventHandler } from "@utils/security";
import { createSignal, onCleanup, Show } from "solid-js";

export interface ICopyableProps {
  text: string;
  before?: string;
  after?: string;
}

export const Copyable = (props: ICopyableProps) => {
  const [state, setState] = createSignal<"idle" | "copied">("idle");
  const [timer, setTimer] = createSignal<NodeJS.Timeout | undefined>();

  const handleClick = eventHandler(async () => {
    if (state() === "copied") return;

    await navigator.clipboard.writeText(props.text);
    setState("copied");

    const t = setTimeout(() => {
      setState("idle");
    }, 3000);

    setTimer(t);
  });

  onCleanup(() => {
    if (timer() === undefined) return;
    clearTimeout(timer());
  });

  return (
    <div class="flex rounded-md gap-2 px-2 py-1 bg-gray-115 items-center cursor-pointer" onClick={handleClick}>
      <p class="font-normal text-xs text-gray-165">
        <Show when={props.before}>{props.before} </Show>
        {props.text}
        <Show when={props.after}> {props.after}</Show>
      </p>
      <Icon kind={state() === "idle" ? EIconKind.Copy : EIconKind.CheckCircle} color={COLORS.gray[165]} size={14} />
    </div>
  );
};
