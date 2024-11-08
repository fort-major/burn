import { Principal } from "@dfinity/principal";
import { useTokens } from "@store/tokens";
import { useWallet } from "@store/wallet";
import { logInfo } from "@utils/error";
import { eventHandler } from "@utils/security";
import { IClass } from "@utils/types";

export interface ITokenIconProps extends IClass {
  tokenCanId: Principal;
}

export function TokenIcon(props: ITokenIconProps) {
  const { metadata } = useTokens();
  const { addSavedToken } = useWallet();

  const meta = () => metadata[props.tokenCanId.toText()];

  const handleClick = eventHandler(() => {
    addSavedToken(props.tokenCanId);
    logInfo(`${meta()?.name} has been inported to your wallet!`);
  });

  return (
    <img
      src={meta()?.logoSrc}
      class="rounded-full cursor-pointer"
      classList={{ [props.class!]: !!props.class }}
      onClick={handleClick}
    />
  );
}
