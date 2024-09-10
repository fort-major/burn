import { ROOT } from "@/routes";
import { EIconKind, Icon } from "@components/icon";
import { A, useLocation, useNavigate } from "@solidjs/router";
import { COLORS } from "@utils/colors";
import { eventHandler } from "@utils/security";
import { IClass } from "@utils/types";

export interface IBacklinkProps extends IClass {
  to?: string;
}

export function Backlink(props: IBacklinkProps) {
  const navigate = useNavigate();

  const handleBack = eventHandler(() => {
    if (props.to) {
      navigate(props.to);
      return;
    }

    try {
      navigate(-1);
    } catch (_) {
      navigate(ROOT.path);
    }
  });

  return (
    <div
      class="flex items-center flex-grow justify-start self-stretch gap-1 cursor-pointer"
      classList={{ [props.class!]: !!props.class }}
      onClick={handleBack}
    >
      <Icon kind={EIconKind.ArrowRight} class="rotate-180" color={COLORS.gray[150]} size={18} />
      <p class="font-primary font-light text-sm underline text-gray-150">Back</p>
    </div>
  );
}
