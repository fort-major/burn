import {
  Accessor,
  batch,
  createContext,
  createEffect,
  createResource,
  createSignal,
  on,
  onMount,
  useContext,
} from "solid-js";
import { IChildren, ONE_WEEK_NS } from "../utils/types";
import { ErrorCode, err, logErr, logInfo } from "../utils/error";
import { Identity, Agent } from "@dfinity/agent";
import { MsqClient, MsqIdentity } from "@fort-major/msq-client";
import { makeAgent, makeAnonymousAgent } from "../utils/backend";
import { AuthClient } from "@dfinity/auth-client";
import { debugStringify } from "@utils/encoding";

export type TAuthProvider = "MSQ" | "II";

export interface IAuthStoreContext {
  authorize: (provider: TAuthProvider, isMembered: boolean) => Promise<boolean>;
  deauthorize: () => Promise<void>;
  authProvider: () => TAuthProvider | undefined;
  identity: Accessor<Identity | undefined>;

  iiClient: Accessor<AuthClient | undefined>;

  agent: Accessor<Agent | undefined>;
  anonymousAgent: Accessor<Agent | undefined>;

  isAuthorized: Accessor<boolean>;
  isReadyToFetch: Accessor<boolean>;
  assertReadyToFetch: () => never | void;
  assertAuthorized: () => never | void;

  disabled: Accessor<boolean>;
  disable: () => void;
  enable: () => void;
}

const AuthContext = createContext<IAuthStoreContext>();

export function useAuth(): IAuthStoreContext {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    err(ErrorCode.UNREACHEABLE, "Auth context is not initialized");
  }

  return ctx;
}

export type TAutoAuthState = "attepting" | "success" | "fail" | "unavailable";

export function AuthStore(props: IChildren) {
  const [identity, setIdentity] = createSignal<Identity>();
  const [msqClient, setMsqClient] = createSignal<MsqClient>();
  const [agent, setAgent] = createSignal<Agent>();
  const [anonymousAgent, setAnonymousAgent] = createSignal<Agent>();
  const [disabled, setDisabled] = createSignal(false);

  const [iiClient] = createResource(() => AuthClient.create({ idleOptions: { disableDefaultIdleCallback: true } }));

  onMount(() => {
    makeAnonymousAgent().then((a) => setAnonymousAgent(a));
  });

  createEffect(
    on(iiClient, async (client) => {
      if (!client) return;

      const rememberedProvider = retrieveRememberedAuthProvider();

      if (rememberedProvider !== null) {
        try {
          await authorize(rememberedProvider, true);
        } catch (e) {
          logErr(ErrorCode.AUTH, debugStringify(e));
          storeRememberedAuthProvider(null);
        } finally {
          enable();
        }
      }
    })
  );

  const disable = () => setDisabled(true);
  const enable = () => setDisabled(false);

  const authProvider: IAuthStoreContext["authProvider"] = () => {
    if (msqClient()) return "MSQ";
    if (iiClient()) return "II";

    return undefined;
  };

  const deauthorize: IAuthStoreContext["deauthorize"] = async () => {
    assertAuthorized();

    disable();

    await msqClient()?.requestLogout();
    await iiClient()?.logout();

    storeRememberedAuthProvider(null);

    batch(() => {
      setAgent(undefined);
      setIdentity(undefined);
      setMsqClient(undefined);
    });

    enable();
  };

  const authorize: IAuthStoreContext["authorize"] = async (provider, isRemembered) => {
    if (provider === "MSQ") {
      disable();

      const result = await MsqClient.createAndLogin();

      if ("Err" in result) {
        enable();
        err(ErrorCode.AUTH, result.Err);
      }

      const { msq, identity } = result.Ok;

      setMsqClient(msq);

      await initIdentity(identity);

      storeRememberedAuthProvider("MSQ");
      enable();

      return true;
    } else {
      disable();

      const client = iiClient();
      if (!client) {
        enable();
        err(ErrorCode.AUTH, "Uninitialized auth client");
      }

      const isAuthenticated = await client.isAuthenticated();

      if (isAuthenticated) {
        const identity = client.getIdentity();

        await initIdentity(identity);
        enable();

        return true;
      }

      if (!isRemembered) {
        try {
          await new Promise((res, rej) =>
            client.login({
              identityProvider: iiFeHost(),
              onSuccess: res,
              onError: rej,
              maxTimeToLive: ONE_WEEK_NS,
            })
          );

          const identity = client.getIdentity();

          await initIdentity(identity);

          storeRememberedAuthProvider("II");
          enable();

          return true;
        } finally {
          enable();
        }
      }

      storeRememberedAuthProvider(null);
      enable();

      return false;
    }
  };

  const initIdentity = async (identity: Identity) => {
    let a = await makeAgent(identity);

    batch(() => {
      setIdentity(identity);
      setAgent(a);
    });

    logInfo("Login successful");
  };

  const isAuthorized = () => {
    return !!agent();
  };

  const isReadyToFetch = () => {
    return !!anonymousAgent();
  };

  const assertReadyToFetch = () => {
    if (!isReadyToFetch()) {
      err(ErrorCode.UNREACHEABLE, "Not ready to fetch");
    }
  };

  const assertAuthorized = () => {
    if (!isAuthorized()) {
      err(ErrorCode.UNREACHEABLE, "Not authorized");
    }
  };

  return (
    <AuthContext.Provider
      value={{
        identity,
        authProvider,
        authorize,
        deauthorize,
        agent,
        anonymousAgent,
        isAuthorized,
        isReadyToFetch,
        assertReadyToFetch,
        assertAuthorized,
        disabled,
        disable,
        enable,
        iiClient,
      }}
    >
      {props.children}
    </AuthContext.Provider>
  );
}

const REMEMBERED_AUTH_PROVIDER_KEY = "msq-burn-auth-provider";

function retrieveRememberedAuthProvider(): TAuthProvider | null {
  return localStorage.getItem(REMEMBERED_AUTH_PROVIDER_KEY) as TAuthProvider | null;
}

function storeRememberedAuthProvider(provider: TAuthProvider | null) {
  if (provider === null) {
    localStorage.removeItem(REMEMBERED_AUTH_PROVIDER_KEY);
  } else {
    localStorage.setItem(REMEMBERED_AUTH_PROVIDER_KEY, provider);
  }
}

export function iiFeHost(): string {
  if (import.meta.env.MODE === "ic") return "https://identity.ic0.app/";

  return import.meta.env.VITE_IC_HOST.replace("http://", `http://${import.meta.env.VITE_II_CANISTER_ID}.`);
}
