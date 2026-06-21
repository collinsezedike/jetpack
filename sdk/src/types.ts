/** On-chain representation of a SpendingCap object. */
export interface SpendingCap {
  id:            string;
  owner:         string;
  agent:         string;
  spendLimit:    bigint;
  spent:         bigint;
  /** Unix timestamp in milliseconds after which the cap is invalid. 0 = no expiry. */
  expiresAt:     bigint;
  /** If non-empty, only these addresses may receive payments. */
  allowedPayees: string[];
  revoked:       boolean;
}

export interface IssueCapParams {
  /** Address of the agent authorised to spend. */
  agent:          string;
  /** Maximum total spend in MIST (1 SUI = 1_000_000_000 MIST). */
  spendLimit:     bigint;
  /** Unix timestamp in milliseconds after which the cap expires. 0 = no expiry. */
  expiresAt?:     bigint;
  /** Restrict payments to these addresses only. Leave empty for any payee. */
  allowedPayees?: string[];
}

export interface PayParams {
  capId:  string;
  payee:  string;
  amount: bigint;
}

export interface IssueCapResult {
  capId:  string;
  digest: string;
}

export interface TxResult {
  digest: string;
}

export interface JetpackClientOptions {
  network?:   "mainnet" | "testnet" | "devnet" | "localnet";
  /** Override the deployed package ID (e.g. for a mainnet deployment). */
  packageId?: string;
  /** Override the RPC URL. Defaults to the public fullnode for the chosen network. */
  rpcUrl?:    string;
}
