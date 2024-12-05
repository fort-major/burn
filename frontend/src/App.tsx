import { Router } from "@solidjs/router";
import { getSolidRoutes } from "./routes";
import { IChildren } from "./utils/types";
import { Toaster } from "solid-toast";
import { AuthStore } from "./store/auth";
import { ErrorBoundary } from "solid-js";
import { ErrorCode } from "./utils/error";
import { Header } from "@components/header";
import { TokensStore } from "@store/tokens";
import { BurnerStore } from "@store/burner";
import { WalletStore } from "@store/wallet";
import { FurnaceStore } from "@store/furnace";
import { DispensersStore } from "@store/dispensers";
import { Wallet } from "@components/wallet";
import { TradingInvitesStore } from "@store/trading-invites";
import { TradingStore } from "@store/trading";

const AppRoot = (props: IChildren) => (
  <>
    <ErrorBoundary
      fallback={(e) => {
        console.error(ErrorCode.UNKNOWN, "FATAL", e);

        return undefined;
      }}
    >
      <AuthStore>
        <TokensStore>
          <WalletStore>
            <BurnerStore>
              <FurnaceStore>
                <DispensersStore>
                  <TradingInvitesStore>
                    <TradingStore>
                      <Header />
                      <main class="flex flex-col flex-grow self-stretch pt-12 lg:pt-[80px]">{props.children}</main>
                      <Wallet />
                    </TradingStore>
                  </TradingInvitesStore>
                </DispensersStore>
              </FurnaceStore>
            </BurnerStore>
          </WalletStore>
        </TokensStore>
      </AuthStore>
    </ErrorBoundary>
    <Toaster />
  </>
);

function App() {
  return <Router root={AppRoot}>{getSolidRoutes()}</Router>;
}

export default App;
