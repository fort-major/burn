import { ValidationError } from "@components/validation-error";
import { useAuth } from "@store/auth";
import { EDs } from "@utils/math";
import { eventHandler } from "@utils/security";
import { Result } from "@utils/types";
import { createSignal, onMount, Setter, Show } from "solid-js";

export type TQtyInputValidation = { required: null } | { min: EDs } | { max: EDs };

export interface IQtyInputProps {
  value: Result<EDs, string>;
  decimals: number;
  fee?: EDs;
  onChange: (v: Result<EDs, string>) => void;
  symbol: string;
  validations?: TQtyInputValidation[];
  disabled?: boolean;
  placeholder?: string;
}

export function QtyInput(props: IQtyInputProps) {
  const { disabled } = useAuth();

  const [error, setError] = createSignal<string | undefined>();

  const d = () => props.disabled || disabled();

  onMount(() => {
    if (props.value.isErr()) return;

    const error = isValid(props.value.unwrapOk(), props.validations);
    props.onChange(error ? Result.Err(props.value.unwrapOk().val.toString()) : props.value);
  });

  const handleChange = eventHandler((e: Event & { target: HTMLInputElement }) => {
    processChange(e.target.value);
  });

  const processChange = (v: string) => {
    try {
      const ve = EDs.fromString(v, props.decimals);
      const er = isValid(ve, props.validations);

      setError(er);

      props.onChange(er ? Result.Err<EDs, string>(v) : Result.Ok<EDs, string>(ve));
    } catch (_) {
      props.onChange(Result.Err<EDs, string>(v));
    }
  };

  const max = () => {
    const m = props.validations?.find((it) => "max" in it);
    if (!m) return;

    return m.max;
  };

  const handleMaxClick = () => {
    let m = max()!;

    if (props.fee) {
      m = m.sub(props.fee);
    }

    props.onChange(Result.Ok(m));
  };

  return (
    <div class="flex flex-col gap-1">
      <div class="relative flex flex-col gap-1 min-w-52 bg-black border-b-[1px] border-gray-140">
        <div class="flex items-center justify-between p-2 gap-1">
          <input
            class="font-primary text-md placeholder-gray-140 font-medium leading-6 text-white bg-black focus:outline-none flex-grow"
            placeholder={props.placeholder ? props.placeholder : max() ? `Max is ${max()!.toString()}` : "Amount..."}
            type="text"
            value={props.value.unwrap().toString()}
            onChange={handleChange}
            disabled={d()}
          />
          <p class="font-primary text-md font-normal leading-6 text-gray-150">{props.symbol}</p>
        </div>
        <ValidationError error={error()} />
      </div>
      <Show when={max()}>
        <div
          class="flex flex-col items-end self-end text-xs text-gray-140 underline italic cursor-pointer px-2"
          onClick={handleMaxClick}
        >
          max
        </div>
      </Show>
    </div>
  );
}

function isValid(v?: EDs | number, validations?: TQtyInputValidation[]): string | undefined {
  if (!validations || validations.length == 0) return undefined;

  for (let validation of validations) {
    if ("required" in validation) {
      if (v === undefined) return "The field is required";
    }

    if ("min" in validation) {
      if ((v as EDs).lt(validation.min as EDs)) return `Min is ${validation.min.toString()}`;
    }

    if ("max" in validation) {
      if ((v as EDs).gt(validation.max as EDs)) return `Max is ${validation.max.toString()}`;
    }
  }

  return undefined;
}
