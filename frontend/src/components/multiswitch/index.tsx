import { eventHandler } from "@utils/security";
import { createSignal } from "solid-js";

export interface IMultiswitchProps {
  states: string[];
  defaultIdx?: number;
  onChange: (stateIdx: number) => void;
}

export const Multiswitch = (props: IMultiswitchProps) => {
  const [value, setValue] = createSignal(props.defaultIdx ?? 0);

  const handleChange = eventHandler((e: Event & { target: HTMLInputElement }) => {
    const val = parseInt(e.target.value);

    props.onChange(val);
    setValue(val);
  });

  return (
    <div class="flex gap-2 items-center justify-between">
      <input
        type="range"
        class="accent-orange outline-none border-none"
        min={0}
        max={props.states.length - 1}
        value={value()}
        onChange={handleChange}
      />
      <p class="text-sm font-semibold">{props.states[value()]}</p>
    </div>
  );
};
