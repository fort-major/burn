import { err, ErrorCode, logErr, logInfo } from "@utils/error";
import { IChildren } from "@utils/types";
import { Accessor, batch, createContext, createEffect, createSignal, on, onMount, useContext } from "solid-js";
import { useAuth } from "./auth";
import { newTradingInvitesActor, opt, optUnwrap } from "@utils/backend";
import { createStore, Store } from "solid-js/store";
import { Principal } from "@dfinity/principal";
import { bytesToHex, hexToBytes } from "@utils/encoding";
import { useWallet } from "./wallet";
import { DEFAULT_TOKENS, useTokens } from "./tokens";
import { delay } from "@fort-major/msq-shared";

const BRIBE_QTY_E8S = 1000_0000_0000n;

export interface ITradingInvitesStoreContext {
  hasInvite: Accessor<boolean | undefined>;
  isRegistered: Accessor<boolean | undefined>;
  myInvite: Accessor<Uint8Array | undefined>;
  fetchMyInvite: () => Promise<void>;

  inviteOwners: Store<Partial<Record<string, Principal>>>;
  fetchInviteOwner: (invite: Uint8Array) => Promise<void>;

  canUpdateMyInvite: () => boolean;
  updateMyInvite: () => Promise<void>;

  canRegisterWithInvite: (invite: string) => boolean;
  registerWithInvite: (invite: string) => Promise<boolean>;

  canRegisterWithBribe: () => boolean;
  registerWithBribe: () => Promise<boolean>;
}

const TradingInvitesContext = createContext<ITradingInvitesStoreContext>();

export function useTradingInvites(): ITradingInvitesStoreContext {
  const ctx = useContext(TradingInvitesContext);

  if (!ctx) {
    err(ErrorCode.UNREACHEABLE, "Trading invites context is not initialized");
  }

  return ctx;
}

export function TradingInvitesStore(props: IChildren) {
  const { isAuthorized, assertAuthorized, assertReadyToFetch, agent, anonymousAgent, enable, disable } = useAuth();
  const { pidBalance, subaccount, transferNoDisable } = useWallet();

  const [hasInvite, setHasInvite] = createSignal<boolean>();
  const [isRegistered, setRegistered] = createSignal<boolean>();
  const [myInvite, setMyInvite] = createSignal<Uint8Array>();
  const [inviteOwners, setInviteOwners] = createStore<ITradingInvitesStoreContext["inviteOwners"]>();

  onMount(() => {
    if (isAuthorized()) {
      fetchMyInvite();
    }
  });

  createEffect(
    on(isAuthorized, (ready) => {
      if (ready) {
        fetchMyInvite();
      }
    })
  );

  const canRegisterWithInvite: ITradingInvitesStoreContext["canRegisterWithInvite"] = (invite: string) => {
    if (!isAuthorized()) return false;
    if (cachedIsRegistered()) return false;

    const owner = inviteOwners[invite];
    if (!owner) return false;

    return true;
  };

  const registerWithInvite: ITradingInvitesStoreContext["registerWithInvite"] = async (invite: string) => {
    assertAuthorized();

    try {
      disable();

      logInfo("Registering... please, wait");

      const inv = hexToBytes(invite);
      const tradingInvites = newTradingInvitesActor(agent()!);
      await tradingInvites.register_with_invite(inv);

      await fetchMyInvite();

      return true;
    } catch {
      return false;
    } finally {
      enable();
    }
  };

  const canRegisterWithBribe: ITradingInvitesStoreContext["canRegisterWithBribe"] = () => {
    if (!isAuthorized()) return false;
    if (cachedIsRegistered()) return false;
    if (!subaccount()) return false;

    const balance = pidBalance(DEFAULT_TOKENS.burn);
    if (!balance || balance < BRIBE_QTY_E8S) return false;

    return true;
  };

  const registerWithBribe: ITradingInvitesStoreContext["registerWithBribe"] = async () => {
    assertAuthorized();

    try {
      disable();

      logInfo("Registering... please, wait");

      await transferNoDisable(
        DEFAULT_TOKENS.burn,
        { owner: Principal.fromText(import.meta.env.VITE_TRADING_INVITES_CANISTER_ID), subaccount: opt(subaccount()) },
        BRIBE_QTY_E8S
      );

      const tradingInvites = newTradingInvitesActor(agent()!);

      try {
        await tradingInvites.register_with_bribe();

        await fetchMyInvite();

        return true;
      } catch {
        await tradingInvites.withdraw_from_user_subaccount(DEFAULT_TOKENS.burn);

        return false;
      }
    } catch {
      return false;
    } finally {
      enable();
    }
  };

  const fetchInviteOwner: ITradingInvitesStoreContext["fetchInviteOwner"] = async (invite: Uint8Array) => {
    assertReadyToFetch();

    const tradingInvites = newTradingInvitesActor(anonymousAgent()!);
    const owner = optUnwrap(await tradingInvites.get_invite_owner(invite));

    if (!owner) {
      logErr(ErrorCode.UNKNOWN, "Expired invite");
      return;
    }

    const inviteHex = bytesToHex(invite);
    setInviteOwners(inviteHex, owner);
  };

  const fetchMyInvite: ITradingInvitesStoreContext["fetchMyInvite"] = async () => {
    assertAuthorized();

    const tradingInvites = newTradingInvitesActor(agent()!);
    const resp = await tradingInvites.get_my_info();

    if (resp.length === 0) {
      batch(() => {
        setHasInvite(false);
        setRegistered(false);
      });

      return;
    }

    const info = resp[0];
    let invite = optUnwrap(info.cur_invite);

    localStorage.setItem(ASH_MARKET_IS_REGISTERED_KEY, "true");

    if (!invite && !myInvite()) {
      invite = await tradingInvites.update_my_invite();
    }

    batch(() => {
      setRegistered(true);
      setHasInvite(true);
      setMyInvite(invite as Uint8Array);
    });
  };

  const canUpdateMyInvite: ITradingInvitesStoreContext["canUpdateMyInvite"] = () => {
    if (!isAuthorized()) return false;
    if (!cachedIsRegistered()) return false;

    return true;
  };

  const updateMyInvite: ITradingInvitesStoreContext["updateMyInvite"] = async () => {
    assertAuthorized();

    try {
      disable();
      const tradingInvites = newTradingInvitesActor(agent()!);

      const newInvite = await tradingInvites.update_my_invite();

      setMyInvite(newInvite as Uint8Array);
      logInfo("Your invite was updated, the old one is no more valid");
    } finally {
      enable();
    }
  };

  const cachedIsRegistered = () => {
    if (!isAuthorized()) {
      const cached = localStorage.getItem(ASH_MARKET_IS_REGISTERED_KEY);
      if (cached === "true") return true;
    }

    return isRegistered();
  };

  return (
    <TradingInvitesContext.Provider
      value={{
        hasInvite,
        isRegistered: cachedIsRegistered,
        myInvite,
        fetchMyInvite,

        inviteOwners,
        fetchInviteOwner,

        canUpdateMyInvite,
        updateMyInvite,

        canRegisterWithBribe,
        registerWithBribe,

        canRegisterWithInvite,
        registerWithInvite,
      }}
    >
      {props.children}
    </TradingInvitesContext.Provider>
  );
}

export const ASH_MARKET_IS_REGISTERED_KEY = "msq-burn-ash-market-is-registered";
