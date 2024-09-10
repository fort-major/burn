import { EDs } from "@utils/math";
import { eventHandler } from "@utils/security";
import { createEffect, createSignal, Show } from "solid-js";

export interface IMultiswitchProps {
  states: string[];
  onChange: (val: number) => void;
}

export const Multiswitch = (props: IMultiswitchProps) => {
  const [value, setValue] = createSignal(0);

  const handleChange = eventHandler((e: Event & { target: HTMLInputElement }) => {
    const val = parseInt(e.target.value);

    props.onChange(val);
    setValue(val);
  });

  return (
    <div class="flex gap-1 items-center">
      <input type="range" min={0} max={props.states.length - 1} value={value()} onChange={handleChange} />
      <p class="text-sm font-semibold text-gray-140 w-20">{props.states[value()]}</p>
    </div>
  );
};
