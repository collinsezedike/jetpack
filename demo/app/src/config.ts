export const NETWORK    = "testnet" as const;
export const RPC_URL    = "https://fullnode.testnet.sui.io";
export const EXPLORER   = "https://suiscan.xyz/testnet";
export const SWARM_SIZE = 20;

// Each agent gets a gas coin + a seed payment coin.
// Gas coin must survive the full run; received payments also become gas.
export const AGENT_GAS_MIST = 20_000_000n;  // 0.02 SUI starting gas per agent
export const PAYMENT_MIST   =  1_000_000n;  // 0.001 SUI per transaction
export const SPEND_LIMIT    = 20_000_000n;  // 0.02 SUI cap limit (~20 rounds per agent)
