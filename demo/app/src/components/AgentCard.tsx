import { AgentState, AgentStatus, Strategy } from "../types";
import { formatMist } from "../utils";

const STATUS_STYLES: Record<AgentStatus, string> = {
  idle:      "border-zinc-700   bg-zinc-900   text-zinc-500",
  funded:    "border-blue-700   bg-blue-950   text-blue-400",
  capped:    "border-violet-600 bg-violet-950 text-violet-300",
  paying:    "border-yellow-400 bg-yellow-950 text-yellow-300 animate-pulse",
  exhausted: "border-zinc-600   bg-zinc-900   text-zinc-500",
  dead:      "border-stone-700  bg-stone-950  text-stone-600",
  revoked:   "border-red-600    bg-red-950    text-red-400",
  rejected:  "border-red-800    bg-red-950/40 text-red-600",
};

const STATUS_ICON: Record<AgentStatus, string> = {
  idle:      "·",
  funded:    "◈",
  capped:    "◉",
  paying:    "⟳",
  exhausted: "∅",
  dead:      "💀",
  revoked:   "✕",
  rejected:  "⊘",
};

const STRATEGY_STYLE: Record<Strategy, string> = {
  generous:   "text-blue-400   border-blue-800",
  reciprocal: "text-violet-400 border-violet-800",
  chaotic:    "text-orange-400 border-orange-800",
};

const STRATEGY_LABEL: Record<Strategy, string> = {
  generous:   "GEN",
  reciprocal: "REC",
  chaotic:    "CHA",
};

interface Props {
  agent: AgentState;
  rank:  number;
}

export default function AgentCard({ agent, rank }: Props) {
  const short  = (a: string) => `${a.slice(0, 4)}…${a.slice(-3)}`;
  const net = agent.received - agent.spent;
  const hasActivity = agent.txCount > 0 || agent.rxCount > 0;

  return (
    <div
      className={`
        relative rounded border p-2.5 transition-all duration-200
        ${STATUS_STYLES[agent.status]}
      `}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1">
          <span className="text-[9px] font-bold opacity-30">#{rank}</span>
          <span className="text-[9px] opacity-40">·</span>
          <span className="text-[9px] opacity-40">A{agent.index + 1}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={`text-[9px] font-bold px-1 py-0.5 rounded border ${STRATEGY_STYLE[agent.strategy]}`}>
            {STRATEGY_LABEL[agent.strategy]}
          </span>
          <span className="text-sm leading-none">{STATUS_ICON[agent.status]}</span>
        </div>
      </div>

      <div className="text-[10px] opacity-60 truncate mb-1.5">{short(agent.address)}</div>

      {hasActivity && (
        <>
          <div className={`text-[11px] font-bold mb-1 ${net >= 0n ? "text-green-400" : "text-red-400"}`}>
            {net >= 0n ? "+" : "-"}{formatMist(net >= 0n ? net : -net)}
          </div>
          <div className="grid grid-cols-2 gap-x-2 text-[9px]">
            <div><span className="opacity-40">out </span><span className="text-orange-400">{formatMist(agent.spent)}</span></div>
            <div><span className="opacity-40">in </span><span className="text-green-400">{formatMist(agent.received)}</span></div>
            <div className="opacity-40">{agent.txCount}tx sent</div>
            <div className="opacity-40">{agent.rxCount}tx recv</div>
          </div>
        </>
      )}
    </div>
  );
}
