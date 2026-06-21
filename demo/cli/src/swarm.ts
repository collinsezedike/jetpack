import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SWARM_SIZE, AGENT_GAS_MIST, PAYMENT_MIST, SPEND_LIMIT } from "./config.js";
import { addr, fundAllAgents, issueAllCaps, pay } from "./actions.js";

type Strategy   = "generous" | "reciprocal" | "chaotic";
type AgentStatus = "capped" | "paying" | "dead" | "exhausted" | "revoked";

export interface Agent {
  index:           number;
  kp:              Ed25519Keypair;
  capId:           string;
  strategy:        Strategy;
  spent:           bigint;
  received:        bigint;
  txCount:         number;
  rxCount:         number;
  lastPaidByIndex: number | null;
  status:          AgentStatus;
}

export interface SimState {
  agents:   Agent[];
  totalTx:  number;
  running:  boolean;
  startMs:  number;
  log:      string[];
}

const STRATEGIES: Strategy[] = ["generous", "reciprocal", "chaotic"];

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const R  = "\x1b[0m";
const B  = "\x1b[1m";
const D  = "\x1b[2m";
const GN = "\x1b[32m";
const RD = "\x1b[31m";
const YL = "\x1b[33m";
const BL = "\x1b[34m";
const MG = "\x1b[35m";
const CY = "\x1b[36m";
const GR = "\x1b[90m";

const STRAT_COLOR: Record<Strategy, string> = {
  generous:   BL,
  reciprocal: MG,
  chaotic:    YL,
};

const STATUS_COLOR: Record<AgentStatus, string> = {
  capped:    CY,
  paying:    GN,
  exhausted: GR,
  dead:      GR,
  revoked:   RD,
};

/** Strip ANSI codes to measure visible width. */
function vis(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function pad(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - vis(s)));
}

function rpad(s: string, w: number): string {
  return " ".repeat(Math.max(0, w - vis(s))) + s;
}

function fmt(mist: bigint): string {
  if (mist === 0n) return "0 SUI";
  return `${(Number(mist) / 1e9).toFixed(3)} SUI`;
}

// ── Display ───────────────────────────────────────────────────────────────────

function render(state: SimState, ownerAddress: string): void {
  const { agents, totalTx, running, startMs, log } = state;
  const elapsedSec = (Date.now() - startMs) / 1000;
  const txPerSec   = elapsedSec > 2 ? (totalTx / elapsedSec).toFixed(1) : "...";
  const active     = agents.filter(a => a.status === "paying" || a.status === "capped").length;
  const volume     = BigInt(totalTx) * PAYMENT_MIST;

  const sorted = [...agents].sort((a, b) => {
    const diff = b.received - a.received;
    if (diff > 0n) return 1;
    if (diff < 0n) return -1;
    return 0;
  });

  const lines: string[] = [];
  const W = 78;

  const phase = running ? `${GN}${B}RUNNING${R}` : agents.length === 0 ? `${CY}SETTING UP...${R}` : `${YL}STOPPED${R}`;
  lines.push(`${B}JETPACK${R}  ${D}testnet  ${ownerAddress.slice(0, 18)}...${R}  ${phase}`);
  lines.push("─".repeat(W));
  lines.push("");

  const h = `  ${D}${rpad("RANK", 4)}  ${pad("AGENT", 5)}  ${pad("STRAT", 5)}  ${pad("RECEIVED", 11)}  ${pad("SPENT", 11)}  ${pad("NET", 13)}  ${rpad("TX", 3)}  STATUS${R}`;
  lines.push(h);
  lines.push(`  ${"─".repeat(W - 2)}`);

  for (let i = 0; i < sorted.length; i++) {
    const a   = sorted[i];
    const net = a.received - a.spent;
    const netStr   = net >= 0n ? `${GN}+${fmt(net)}${R}` : `${RD}-${fmt(-net)}${R}`;
    const sc  = STRAT_COLOR[a.strategy];
    const stc = STATUS_COLOR[a.status];

    lines.push(
      `  ${rpad(String(i + 1), 4)}  ${pad(`A${a.index + 1}`, 5)}  ${sc}${pad(a.strategy.slice(0, 3).toUpperCase(), 5)}${R}  ` +
      `${pad(fmt(a.received), 11)}  ${pad(fmt(a.spent), 11)}  ${pad(netStr, 13)}  ` +
      `${rpad(String(a.txCount), 3)}  ${stc}${a.status}${R}`,
    );
  }

  lines.push("");
  lines.push("─".repeat(W));
  lines.push(
    `  ${B}VOLUME${R} ${fmt(volume)}   ${B}TX TOTAL${R} ${totalTx}   ${B}TX/S${R} ${txPerSec}   ${B}ACTIVE${R} ${active}/${agents.length}`,
  );
  lines.push("");

  if (running) {
    lines.push(`  ${D}Ctrl+C to stop and withdraw funds to owner wallet.${R}`);
  } else if (agents.length === 0) {
    lines.push(`  ${D}Preparing swarm...${R}`);
  } else {
    lines.push(`  ${YL}Stopped. Cleaning up — withdrawing funds and revoking caps...${R}`);
  }

  lines.push("");

  for (const l of log.slice(-4)) {
    lines.push(`  ${D}${l}${R}`);
  }

  process.stdout.write("\x1b[H");
  process.stdout.write(lines.join("\n") + "\n");
  process.stdout.write("\x1b[J");
}

// ── Strategy ──────────────────────────────────────────────────────────────────

function pickTarget(agent: Agent, agents: Agent[]): Agent | null {
  const live = agents.filter(
    a => a.index !== agent.index && (a.status === "paying" || a.status === "capped"),
  );
  if (live.length === 0) return null;

  const rnd = () => live[Math.floor(Math.random() * live.length)];

  switch (agent.strategy) {
    case "generous":
      return rnd();

    case "reciprocal": {
      if (agent.lastPaidByIndex !== null) {
        const recip = live.find(a => a.index === agent.lastPaidByIndex);
        if (recip) return recip;
      }
      return rnd();
    }

    case "chaotic":
      return Math.random() < 0.25 ? null : rnd();
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runSwarm(
  owner: Ed25519Keypair,
  ownerAddress: string,
  signal: { stop: boolean },
): Promise<Agent[]> {
  // Enter alternate screen buffer (like vim/htop) -- isolated, never scrolls.
  process.stdout.write("\x1b[?1049h\x1b[H\x1b[?25l");

  const state: SimState = {
    agents:  [],
    totalTx: 0,
    running: false,
    startMs: Date.now(),
    log:     [],
  };

  const log = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    state.log.push(`${ts}  ${msg}`);
    if (state.log.length > 30) state.log.shift();
  };

  const step = (msg: string) => {
    log(msg);
    render(state, ownerAddress);
  };

  step(`Generating ${SWARM_SIZE} agent keypairs...`);
  const keypairs = Array.from({ length: SWARM_SIZE }, () => new Ed25519Keypair());

  if (signal.stop) return [];

  step(`Funding ${SWARM_SIZE} agents (one transaction)...`);
  await fundAllAgents(owner, keypairs.map(addr), AGENT_GAS_MIST, SPEND_LIMIT + 1_000_000n);

  if (signal.stop) return [];

  step(`Issuing ${SWARM_SIZE} SpendingCaps (one transaction)...`);
  const capIds = await issueAllCaps(owner, keypairs.map(addr), SPEND_LIMIT);

  state.agents = keypairs.map((kp, i) => ({
    index:           i,
    kp,
    capId:           capIds[i],
    strategy:        STRATEGIES[i % STRATEGIES.length],
    spent:           0n,
    received:        0n,
    txCount:         0,
    rxCount:         0,
    lastPaidByIndex: null,
    status:          "capped" as AgentStatus,
  }));

  state.running = true;
  state.startMs = Date.now();
  log("Caps issued. Swarm is live.");
  render(state, ownerAddress);

  // Brief wait for coin objects to be indexed.
  await new Promise(r => setTimeout(r, 2000));

  const displayInterval = setInterval(() => render(state, ownerAddress), 250);

  const agentLoops = state.agents.map(async (agent, i) => {
    // Stagger starts to avoid thundering herd.
    await new Promise(r => setTimeout(r, i * 80));

    while (!signal.stop) {
      const live = state.agents.filter(
        a => a.status === "paying" || a.status === "capped",
      );
      if (live.length <= 1) break;

      const target = pickTarget(agent, state.agents);
      if (!target) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      agent.status = "paying";
      try {
        await pay(agent.kp, agent.capId, addr(target.kp), PAYMENT_MIST);
        agent.spent           += PAYMENT_MIST;
        agent.txCount         += 1;
        target.received       += PAYMENT_MIST;
        target.rxCount        += 1;
        target.lastPaidByIndex = agent.index;
        state.totalTx         += 1;
        log(`A${agent.index + 1} → A${target.index + 1}`);
        agent.status = "paying";
      } catch (err) {
        const msg = String(err);
        if (msg.includes("Insufficient") || msg.includes("insufficient")) {
          agent.status = "dead";
          log(`A${agent.index + 1} out of gas — dead`);
          break;
        } else if (msg.includes("ESpend") || msg.includes("ECap") || msg.includes("spend limit")) {
          agent.status = "exhausted";
          log(`A${agent.index + 1} cap exhausted`);
          break;
        } else {
          log(`A${agent.index + 1} error: ${msg.slice(0, 55)}`);
        }
      }
    }
  });

  await Promise.all(agentLoops);

  clearInterval(displayInterval);
  state.running = false;
  render(state, ownerAddress);

  return state.agents;
}
