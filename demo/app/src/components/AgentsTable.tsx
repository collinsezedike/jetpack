import { motion } from "framer-motion";
import { AgentState, Strategy } from "../types";
import { EXPLORER } from "../config";
import { formatMist, shortAddr } from "../utils";

const STRATEGY_STYLE: Record<Strategy, string> = {
  generous:   "text-blue-400   border-blue-800   bg-blue-950",
  reciprocal: "text-violet-400 border-violet-800 bg-violet-950",
  chaotic:    "text-orange-400 border-orange-800 bg-orange-950",
};

const STRATEGY_DESC: Record<Strategy, string> = {
  generous:   "Pays a random agent every round",
  reciprocal: "Pays whoever paid it last (tit-for-tat); random on first move",
  chaotic:    "75% chance of paying a random agent; 25% chance of skipping",
};

function ExLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-zinc-400 hover:text-white underline underline-offset-2 decoration-zinc-700 hover:decoration-white transition-colors font-mono"
    >
      {label}
    </a>
  );
}

interface Props { agents: AgentState[]; onRevoke: (index: number) => void }

const REVOCABLE: AgentState["status"][] = ["capped", "paying", "exhausted"];

export default function AgentsTable({ agents, onRevoke }: Props) {
  if (agents.length === 0) {
    return (
      <div className="rounded border border-zinc-800 bg-zinc-950 p-8 text-center text-zinc-600 text-sm">
        Run SETUP to generate agents.
      </div>
    );
  }

  const sorted = [...agents].sort((a, b) => {
    const diff = b.received - a.received;
    if (diff > 0n) return 1;
    if (diff < 0n) return -1;
    return 0;
  });

  return (
    <div className="space-y-6">
      {/* Strategy legend */}
      <div className="flex flex-wrap gap-3">
        {(["generous", "reciprocal", "chaotic"] as Strategy[]).map((s) => (
          <div key={s} className={`flex items-start gap-2 rounded border px-3 py-2 text-[11px] ${STRATEGY_STYLE[s]}`}>
            <span className="font-bold uppercase tracking-widest shrink-0">
              {s.slice(0, 3).toUpperCase()}
            </span>
            <span className="opacity-70">{STRATEGY_DESC[s]}</span>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded border border-zinc-800">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500 tracking-widest text-[9px]">
              <th className="text-left px-3 py-2">RANK</th>
              <th className="text-left px-3 py-2">AGENT</th>
              <th className="text-left px-3 py-2">STRAT</th>
              <th className="text-left px-3 py-2">ADDRESS</th>
              <th className="text-left px-3 py-2">CAP</th>
              <th className="text-right px-3 py-2">SPENT</th>
              <th className="text-right px-3 py-2">RECEIVED</th>
              <th className="text-right px-3 py-2">TX SENT</th>
              <th className="text-left px-3 py-2">RECENT TXN</th>
              <th className="text-left px-3 py-2">STATUS</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a, rank) => (
              <motion.tr
                key={a.index}
                layout
                transition={{ type: "spring", stiffness: 350, damping: 30 }}
                className="border-b border-zinc-900 hover:bg-zinc-900/50 transition-colors"
              >
                <td className="px-3 py-2 text-zinc-400 font-bold">{rank + 1}</td>

                <td className="px-3 py-2 text-zinc-600">A{a.index + 1}</td>

                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${STRATEGY_STYLE[a.strategy]}`}>
                    {a.strategy.slice(0, 3).toUpperCase()}
                  </span>
                </td>

                <td className="px-3 py-2">
                  <ExLink
                    href={`${EXPLORER}/account/${a.address}`}
                    label={shortAddr(a.address)}
                  />
                </td>

                <td className="px-3 py-2">
                  {a.capId
                    ? <ExLink href={`${EXPLORER}/object/${a.capId}`} label={shortAddr(a.capId)} />
                    : <span className="text-zinc-700">--</span>
                  }
                </td>

                <td className="px-3 py-2 text-right text-orange-400">
                  {a.spent > 0n ? formatMist(a.spent) : <span className="text-zinc-700">0</span>}
                </td>

                <td className="px-3 py-2 text-right text-green-400">
                  {a.received > 0n ? formatMist(a.received) : <span className="text-zinc-700">0</span>}
                </td>

                <td className="px-3 py-2 text-right text-zinc-400">{a.txCount}</td>

                <td className="px-3 py-2 space-y-0.5">
                  {a.txns.slice(0, 3).map((tx) => (
                    <div key={tx.digest}>
                      <ExLink
                        href={`${EXPLORER}/tx/${tx.digest}`}
                        label={tx.digest.slice(0, 10) + "..."}
                      />
                    </div>
                  ))}
                  {a.txns.length === 0 && <span className="text-zinc-700">--</span>}
                </td>

                <td className="px-3 py-2">
                  <StatusPill status={a.status} />
                </td>

                <td className="px-3 py-2">
                  {REVOCABLE.includes(a.status) && (
                    <button
                      onClick={() => onRevoke(a.index)}
                      className="text-[9px] font-bold px-2 py-1 rounded border
                                 border-red-800 text-red-400 hover:bg-red-900 transition-colors"
                      title="Withdraw funds then revoke cap"
                    >
                      REVOKE
                    </button>
                  )}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: AgentState["status"] }) {
  const styles: Record<AgentState["status"], string> = {
    idle:      "text-zinc-500   bg-zinc-900",
    funded:    "text-blue-400   bg-blue-950",
    capped:    "text-violet-300 bg-violet-950",
    paying:    "text-yellow-300 bg-yellow-950",
    exhausted: "text-zinc-500   bg-zinc-900",
    dead:      "text-stone-500  bg-stone-950",
    revoked:   "text-red-400    bg-red-950",
    rejected:  "text-red-600    bg-red-950",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${styles[status]}`}>
      {status}
    </span>
  );
}
