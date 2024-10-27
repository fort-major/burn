interface ImportMeta {
  readonly env: {
    DEV: boolean;
    MODE: "dev" | "ic";
    VITE_BURNER_CANISTER_ID: string;
    VITE_BURN_TOKEN_CANISTER_ID: string;
    VITE_FURNACE_CANISTER_ID: string;
    VITE_II_CANISTER_ID: string;
    VITE_ROOT_KEY: string;
    VITE_IC_HOST: string;
  };
}
