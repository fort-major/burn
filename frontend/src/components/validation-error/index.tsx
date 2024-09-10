import { Show } from "solid-js";

export function ValidationError(props: { error?: string }) {
  return (
    <Show when={props.error}>
      <p class="absolute bottom-[-18px] flex px-2 font-mono font-thin text-xs text-errorRed">{props.error}</p>
    </Show>
  );
}
