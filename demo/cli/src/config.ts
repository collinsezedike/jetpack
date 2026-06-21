export const NETWORK = "testnet" as const;

// Swarm tuning -- enough to survive on a single faucet drop.
export const SWARM_SIZE     = 20;
export const AGENT_GAS_MIST = 20_000_000n;  // 0.02 SUI per agent for gas
export const PAYMENT_MIST   =  1_000_000n;  // 0.001 SUI per payment
export const SPEND_LIMIT    = 20_000_000n;  // 0.02 SUI cap limit (~20 payments per agent)
