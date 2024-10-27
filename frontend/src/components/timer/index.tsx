import { Show } from "solid-js";

export interface ITimerProps {
  days: number;
  hours: number;
  minutes: number;
  class?: string;
  descriptionClass?: string;
  zeroText?: string;
}

export function Timer(props: ITimerProps) {
  return (
    <div class="flex gap-3 items-center font-semibold" classList={{ [props.class!]: !!props.class }}>
      <Show when={props.days > 0}>
        <p>
          {props.days} <span class={props.descriptionClass}>days</span>
        </p>
      </Show>
      <Show when={props.hours > 0}>
        <p>
          {props.hours} <span class={props.descriptionClass}>hours</span>
        </p>
      </Show>
      <p>
        {Math.max(props.minutes, 0)} <span class={props.descriptionClass}>minutes</span>
      </p>
    </div>
  );
}
