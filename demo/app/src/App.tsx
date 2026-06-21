import { useState, useCallback, useRef } from "react";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { AgentState, LogEntry, Strategy, TxRecord } from "./types";
import { SWARM_SIZE, AGENT_GAS_MIST, PAYMENT_MIST, SPEND_LIMIT } from "./config";
import {
  loadOwnerFromKey, fundAllAgents, issueAllCaps, pay, revoke, withdrawAgent, addr,
} from "./actions";
import AgentGrid    from "./components/AgentGrid";
import AgentsTable  from "./components/AgentsTable";
import EventFeed    from "./components/EventFeed";
import ControlPanel from "./components/ControlPanel";
import AboutPanel   from "./components/AboutPanel";

type Phase = "idle" | "funding" | "issuing" | "capped" | "running" | "done";
type Tab   = "swarm" | "agents" | "about";

const STRATEGIES: Strategy[] = ["generous", "reciprocal", "chaotic"];

function makeAgents(keypairs: Ed25519Keypair[]): AgentState[] {
  return keypairs.map((kp, i) => ({
    index:           i,
    address:         addr(kp),
    capId:           null,
    status:          "idle" as const,
    strategy:        STRATEGIES[i % STRATEGIES.length],
    spent:           0n,
    received:        0n,
    txCount:         0,
    rxCount:         0,
    lastPaidByIndex: null,
    txns:            [],
  }));
}

function pickTarget(
  myIndex:    number,
  strategy:   Strategy,
  allIndices: number[],
  lastPaidBy: (number | null)[],
): number | null {
  const others = allIndices.filter((i) => i !== myIndex);
  if (others.length === 0) return null;
  const random = () => others[Math.floor(Math.random() * others.length)];

  if (strategy === "generous") return random();
  if (strategy === "reciprocal") {
    const last = lastPaidBy[myIndex];
    return last !== null && others.includes(last) ? last : random();
  }
  // chaotic: 25% chance to skip
  return Math.random() < 0.25 ? null : random();
}

let logCounter = 0;

export default function App() {
  const [phase,    setPhase]    = useState<Phase>("idle");
  const [agents,   setAgents]   = useState<AgentState[]>([]);
  const [logs,     setLogs]     = useState<LogEntry[]>([]);
  const [keyInput, setKeyInput] = useState(import.meta.env.VITE_OWNER_PRIVATE_KEY ?? "");
  const [showKey,  setShowKey]  = useState(false);
  const [tab, setTab] = useState<Tab>("swarm");

  const ownerRef       = useRef<Ed25519Keypair | null>(null);
  const agentKpsRef    = useRef<Ed25519Keypair[]>([]);
  const gameRunningRef = useRef(false);
  const runStartRef    = useRef<number | null>(null);

  // Mutable game state lives in a ref so the async loop always sees fresh values
  const gs = useRef({
    capIds:     [] as (string | null)[],
    strategies: [] as Strategy[],
    lastPaidBy: [] as (number | null)[],
    exhausted:  [] as boolean[],
    revoked:    [] as boolean[],
  });

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------
  const log = useCallback((message: string, kind: LogEntry["kind"] = "info") => {
    setLogs((prev) => [...prev, { id: logCounter++, ts: Date.now(), message, kind }]);
  }, []);

  const patchAgent = useCallback((index: number, patch: Partial<AgentState>) => {
    setAgents((prev) => prev.map((a) => a.index === index ? { ...a, ...patch } : a));
  }, []);

  const totalTx = agents.reduce((sum, a) => sum + a.txCount, 0);
  const elapsedSec = runStartRef.current ? (Date.now() - runStartRef.current) / 1000 : 0;
  const stats = {
    active:     agents.filter((a) => a.status === "capped" || a.status === "paying").length,
    totalTx,
    volumeMist: BigInt(totalTx) * PAYMENT_MIST,
    txPerSec:   elapsedSec > 1 ? (totalTx / elapsedSec).toFixed(1) : null,
  };

  // ------------------------------------------------------------------
  // SETUP: fund + issue caps
  // ------------------------------------------------------------------
  const handleSetup = useCallback(async () => {
    let owner: Ed25519Keypair;
    try {
      owner = loadOwnerFromKey(keyInput.trim());
    } catch {
      log("Invalid private key. Paste the base64 value from sui.keystore.", "error");
      return;
    }
    ownerRef.current = owner;

    const kps = Array.from({ length: SWARM_SIZE }, () => Ed25519Keypair.generate());
    agentKpsRef.current = kps;
    const fresh = makeAgents(kps);
    setAgents(fresh);
    setLogs([]);
    // Seed game state
    gs.current = {
      capIds:     Array(SWARM_SIZE).fill(null),
      strategies: fresh.map((a) => a.strategy),
      lastPaidBy: Array(SWARM_SIZE).fill(null),
      exhausted:  Array(SWARM_SIZE).fill(false),
      revoked:    Array(SWARM_SIZE).fill(false),
    };

    // Fund
    setPhase("funding");
    log(`Funding ${SWARM_SIZE} agents...`);
    try {
      await fundAllAgents(owner, kps.map(addr), AGENT_GAS_MIST, PAYMENT_MIST);
      kps.forEach((_, i) => patchAgent(i, { status: "funded" }));
      log("All agents funded.", "success");
    } catch (e) {
      log(`Funding failed: ${e}`, "error");
      setPhase("idle");
      return;
    }

    // Issue caps
    setPhase("issuing");
    log("Issuing spending caps...");
    try {
      const capIds = await issueAllCaps(owner, kps.map(addr), SPEND_LIMIT);
      capIds.forEach((capId, i) => {
        gs.current.capIds[i] = capId;
        patchAgent(i, { capId, status: "capped" });
      });
      log(`${SWARM_SIZE} caps issued.`, "success");
      setPhase("capped");
    } catch (e) {
      log(`Cap issuance failed: ${e}`, "error");
      setPhase("idle");
    }
  }, [keyInput, log, patchAgent]);

  // ------------------------------------------------------------------
  // SWARM LOOP
  // ------------------------------------------------------------------
  const handleFire = useCallback(async () => {
    const kps = agentKpsRef.current;
    setPhase("running");
    gameRunningRef.current = true;

    // Let RPC index the freshly created coins
    await new Promise((r) => setTimeout(r, 3000));
    runStartRef.current = Date.now();
    log("Swarm active. Agents are transacting.", "info");

    while (gameRunningRef.current) {
      const active = kps
        .map((_, i) => i)
        .filter((i) => !gs.current.exhausted[i] && !gs.current.revoked[i]);

      if (active.length < 2) break;

      await Promise.allSettled(
        active.map(async (i) => {
          const target = pickTarget(i, gs.current.strategies[i], active, gs.current.lastPaidBy);
          if (target === null) return;

          patchAgent(i, { status: "paying" });

          try {
            const digest = await pay(
              kps[i],
              gs.current.capIds[i]!,
              addr(kps[target]),
              PAYMENT_MIST,
            );

            gs.current.lastPaidBy[target] = i;

            const txRecord: TxRecord = {
              digest,
              from:   addr(kps[i]),
              to:     addr(kps[target]),
              amount: PAYMENT_MIST,
              ts:     Date.now(),
            };

            setAgents((prev) => prev.map((a) => {
              if (a.index === i) {
                return {
                  ...a,
                  status:  "capped",
                  spent:   a.spent + PAYMENT_MIST,
                  txCount: a.txCount + 1,
                  txns:    [txRecord, ...a.txns].slice(0, 10),
                };
              }
              if (a.index === target) {
                return {
                  ...a,
                  received:        a.received + PAYMENT_MIST,
                  rxCount:         a.rxCount + 1,
                  lastPaidByIndex: i,
                };
              }
              return a;
            }));

            log(`Agent ${i + 1} (${gs.current.strategies[i]}) -> Agent ${target + 1}`, "success");
          } catch (e) {
            const msg = String(e);
            if (msg.includes("ECapExhausted") || msg.includes('"abort_code":1') || msg.includes("abort_code: 1")) {
              gs.current.exhausted[i] = true;
              patchAgent(i, { status: "exhausted" });
              log(`Agent ${i + 1} cap exhausted.`, "warn");
            } else if (msg.includes("ECapRevoked") || msg.includes('"abort_code":5') || msg.includes("abort_code: 5")) {
              gs.current.revoked[i] = true;
              patchAgent(i, { status: "revoked" });
              log(`Agent ${i + 1} cap revoked.`, "warn");
            } else if (msg.includes("Insufficient coins")) {
              gs.current.exhausted[i] = true;
              patchAgent(i, { status: "dead" });
              log(`Agent ${i + 1} died (out of gas).`, "error");
            } else {
              patchAgent(i, { status: "capped" });
              log(`Agent ${i + 1} error: ${msg.slice(0, 80)}`, "error");
            }
          }
        }),
      );

      // Pause between rounds to avoid RPC overload
      await new Promise((r) => setTimeout(r, 800));
    }

    setPhase("done");
    if (gameRunningRef.current) {
      log("All caps exhausted. Swarm complete.", "info");
    }
  }, [log, patchAgent]);

  const handleStop = useCallback(() => {
    gameRunningRef.current = false;
    log("Paused.", "warn");
  }, [log]);

  // ------------------------------------------------------------------
  // WITHDRAW: drain all agent wallets back to owner
  // ------------------------------------------------------------------
  const handleWithdraw = useCallback(async () => {
    const owner = ownerRef.current;
    const kps   = agentKpsRef.current;
    if (!owner || kps.length === 0) return;

    const ownerAddress = addr(owner);
    log("Withdrawing all agent funds to owner wallet...", "info");

    const results = await Promise.allSettled(
      kps.map(async (kp, i) => {
        try {
          const digest = await withdrawAgent(kp, ownerAddress);
          if (digest) {
            log(`Agent ${i + 1} withdrawn.`, "success");
          } else {
            log(`Agent ${i + 1} has no coins to withdraw.`, "warn");
          }
        } catch (e) {
          log(`Agent ${i + 1} withdraw failed: ${e}`, "error");
        }
      }),
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    log(`Withdraw complete: ${ok}/${kps.length} agents drained.`, "info");
  }, [log]);

  // ------------------------------------------------------------------
  // REVOKE ALL: withdraw funds first, then revoke caps
  // ------------------------------------------------------------------
  const handleRevokeAll = useCallback(async () => {
    const owner = ownerRef.current;
    if (!owner) return;

    await handleWithdraw();

    const snap = agents;
    log("Revoking all active caps...", "warn");
    await Promise.allSettled(
      snap
        .filter((a) => a.capId && a.status !== "revoked" && a.status !== "exhausted" && a.status !== "dead")
        .map(async (a) => {
          try {
            await revoke(owner, a.capId!);
            gs.current.revoked[a.index] = true;
            patchAgent(a.index, { status: "revoked" });
            log(`Agent ${a.index + 1} revoked.`, "warn");
          } catch (e) {
            log(`Revoke ${a.index + 1} failed: ${e}`, "error");
          }
        }),
    );
  }, [agents, handleWithdraw, log, patchAgent]);

  const handleRevokeSingle = useCallback(async (index: number) => {
    const owner = ownerRef.current;
    const kp    = agentKpsRef.current[index];
    const capId = agents[index]?.capId;
    if (!owner || !kp || !capId) return;

    const ownerAddress = addr(owner);
    log(`Withdrawing agent ${index + 1} funds...`, "info");
    try {
      await withdrawAgent(kp, ownerAddress);
      log(`Agent ${index + 1} funds withdrawn.`, "success");
    } catch (e) {
      log(`Agent ${index + 1} withdraw failed: ${e}`, "error");
    }

    try {
      await revoke(owner, capId);
      gs.current.revoked[index] = true;
      patchAgent(index, { status: "revoked" });
      log(`Agent ${index + 1} cap revoked.`, "warn");
    } catch (e) {
      log(`Agent ${index + 1} revoke failed: ${e}`, "error");
    }
  }, [agents, handleWithdraw, log, patchAgent]);

  const handleReset = useCallback(async () => {
    gameRunningRef.current = false;

    // If caps were issued, withdraw funds and revoke before clearing UI
    const hasCaps = gs.current.capIds.some((id) => id !== null);
    if (hasCaps) await handleRevokeAll();

    setPhase("idle");
    setAgents([]);
    setLogs([]);
    ownerRef.current    = null;
    agentKpsRef.current = [];
    gs.current = { capIds: [], strategies: [], lastPaidBy: [], exhausted: [], revoked: [] };
  }, [handleRevokeAll]);

  // ------------------------------------------------------------------
  // render
  // ------------------------------------------------------------------
  const hasKey = keyInput.trim().length > 10;

  return (
    <div className="min-h-screen bg-[#050508] text-slate-200 font-mono p-4 md:p-8 space-y-6">

      {/* Header */}
      <div className="flex items-end justify-between border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Jetpack" className="w-9 h-9 rounded-lg" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">JETPACK</h1>
              <p className="text-xs text-zinc-500 mt-0.5">
                Scoped spending caps for AI agents on Sui
              </p>
            </div>
          </div>
        </div>
        <button
          disabled
          className="text-xs font-bold tracking-widest px-3 py-1.5 rounded border
                     border-zinc-700 text-zinc-600 bg-zinc-900 cursor-not-allowed"
          title="Mainnet coming soon"
        >
          Switch to Mainnet
        </button>
      </div>

      {/* Key input */}
      <div className="rounded border border-zinc-800 bg-zinc-950 p-4 space-y-2">
        <label className="text-[10px] font-bold tracking-widest text-zinc-500">
          OWNER PRIVATE KEY (base64 from sui.keystore)
        </label>
        <div className="flex gap-2">
          <input
            type={showKey ? "text" : "password"}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="paste base64 key..."
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs
                       text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-violet-500"
          />
          <button
            onClick={() => setShowKey((v) => !v)}
            className="px-3 py-2 text-xs rounded border border-zinc-700 text-zinc-400
                       hover:border-zinc-500 transition-colors"
          >
            {showKey ? "HIDE" : "SHOW"}
          </button>
        </div>
        {!hasKey && (
          <p className="text-[10px] text-zinc-600">
            Run: <span className="text-zinc-400">cat ~/.sui/sui_config/sui.keystore</span> and paste the quoted base64 string.
          </p>
        )}
      </div>

      {/* Control panel */}
      <ControlPanel
        phase={phase}
        stats={stats}
        hasKey={hasKey}
        onSetup={handleSetup}
        onFire={handleFire}
        onStop={handleStop}
        onReset={handleReset}
      />

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-zinc-800">
        {(["swarm", "agents", "about"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-bold tracking-widest transition-colors border-b-2 -mb-px
              ${tab === t
                ? "border-violet-500 text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "swarm" && (
        <div className="space-y-6">
          {agents.length > 0 && <AgentGrid agents={agents} />}
          <div>
            <div className="text-[10px] font-bold tracking-widest text-zinc-600 mb-2">EVENT FEED</div>
            <EventFeed entries={logs} />
          </div>
        </div>
      )}

      {tab === "agents" && <AgentsTable agents={agents} onRevoke={handleRevokeSingle} />}

      {tab === "about" && <AboutPanel />}

    </div>
  );
}
