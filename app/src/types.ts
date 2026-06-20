export type Strategy = "generous" | "reciprocal" | "chaotic";

export type AgentStatus =
  | "idle"
  | "funded"
  | "capped"
  | "paying"
  | "exhausted"
  | "dead"
  | "revoked"
  | "rejected";

export interface TxRecord {
  digest: string;
  to:     string;
  from:   string;
  amount: bigint;
  ts:     number;
}

export interface AgentState {
  index:           number;
  address:         string;
  capId:           string | null;
  status:          AgentStatus;
  strategy:        Strategy;
  spent:           bigint;
  received:        bigint;
  txCount:         number;
  rxCount:         number;
  lastPaidByIndex: number | null;
  txns:            TxRecord[];
}

export interface LogEntry {
  id:      number;
  ts:      number;
  message: string;
  kind:    "info" | "success" | "error" | "warn";
}
