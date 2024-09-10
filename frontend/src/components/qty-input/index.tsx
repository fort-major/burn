import { ValidationError } from "@components/validation-error";
import { useAuth } from "@store/auth";
import { EDs } from "@utils/math";
import { eventHandler } from "@utils/security";
import { Result } from "@utils/types";
import { createSignal, onMount, Setter, Show } from "solid-js";

export type TQtyInputValidation<T> = { required: null } | { min: T } | { max: T };

export interface IQtyInputProps<T extends EDs | number> {
  value: T;
  onChange: (v: Result<T, T>) => void;
  symbol: string;
  validations?: TQtyInputValidation<T>[];
  disabled?: boolean;
}

export function QtyInput<T extends EDs | number>(props: IQtyInputProps<T>) {
  const { disabled } = useAuth();

  const [error, setError] = createSignal<string | undefined>();

  const d = () => props.disabled || disabled();
  const mode = () => (typeof props.value === "number" ? "num" : "e8s");

  onMount(() => {
    const error = isValid(mode(), props.value, props.validations);
    props.onChange(error ? Result.Err(props.value) : Result.Ok(props.value));
  });

  const handleChange = eventHandler((e: Event & { target: HTMLInputElement }) => {
    processChange(e.target.value);
  });

  const processChange = (v: string) => {
    try {
      const ve = mode() === "e8s" ? EDs.fromString(v) : parseInt(v);
      const er = isValid(mode(), ve, props.validations);

      setError(er);

      props.onChange(er ? Result.Err<T, T>(ve as T) : Result.Ok<T, T>(ve as T));
    } catch (_) {
      props.onChange(Result.Err<T, T>(mode() === "e8s" ? (EDs.zero() as T) : (0 as T)));
    }
  };

  return (
    <div class="flex flex-col gap-1 min-w-52">
      <div
        class="flex items-center justify-between p-2 gap-1 shadow-md"
        classList={{ "shadow-errorRed": !!error(), "bg-gray-190": d() }}
      >
        <input
          class="font-primary italic text-md font-medium leading-6 text-black focus:outline-none flex-grow"
          placeholder="Amount..."
          type="text"
          value={props.value.toString()}
          onChange={handleChange}
          disabled={d()}
        />
        <p class="font-primary text-md font-normal leading-6 text-gray-150">{props.symbol}</p>
      </div>
      <ValidationError error={error()} />
    </div>
  );
}

function isValid(
  mode: "e8s" | "num",
  v?: EDs | number,
  validations?: TQtyInputValidation<EDs | number>[]
): string | undefined {
  if (!validations || validations.length == 0) return undefined;

  for (let validation of validations) {
    if ("required" in validation) {
      if (v === undefined) return "The field is required";
    }

    if ("min" in validation) {
      if (mode === "e8s") {
        if ((v as EDs).lt(validation.min as EDs)) return `Min is ${validation.min.toString()}`;
      } else {
        if (v! < validation.min) return `Min is ${validation.min.toString()}`;
      }
    }

    if ("max" in validation) {
      if (mode === "e8s") {
        if ((v as EDs).gt(validation.max as EDs)) return `Max is ${validation.max.toString()}`;
      } else {
        if (v! > validation.max) return `Max is ${validation.max.toString()}`;
      }
    }
  }

  return undefined;
}
