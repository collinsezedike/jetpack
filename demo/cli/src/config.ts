export const NETWORK    = "testnet" as const;
export const PACKAGE_ID = "0xd16d4b8faa7a0ec41b08cea5c570597640bbde339cbc2c384d0b9d5315ec85c6";
export const CLOCK      = "0x6";

// Swarm tuning -- enough to survive on a single faucet drop.
export const SWARM_SIZE     = 20;
export const AGENT_GAS_MIST = 20_000_000n;  // 0.02 SUI per agent for gas
export const PAYMENT_MIST   =  1_000_000n;  // 0.001 SUI per payment
export const SPEND_LIMIT    = 20_000_000n;  // 0.02 SUI cap limit (~20 payments per agent)
