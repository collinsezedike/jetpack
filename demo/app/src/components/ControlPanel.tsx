import { formatMist } from "../utils";

type Phase = "idle" | "funding" | "issuing" | "capped" | "running" | "done";

interface Stats {
  active:     number;
  totalTx:    number;
  volumeMist: bigint;
  txPerSec:   string | null;
}

interface Props {
  phase:   Phase;
  stats:   Stats;
  hasKey:  boolean;
  onSetup: () => void;
  onFire:  () => void;
  onStop:  () => void;
  onReset: () => void;
}

const PHASE_LABEL: Record<Phase, string> = {
  idle:    "READY",
  funding: "FUNDING AGENTS...",
  issuing: "ISSUING CAPS...",
  capped:  "CAPS ISSUED",
  running: "RUNNING",
  done:    "COMPLETE",
};

export default function ControlPanel({
  phase, stats, hasKey, onSetup, onFire, onStop, onReset,
}: Props) {
  const busy    = phase === "funding" || phase === "issuing";
  const running = phase === "running";

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-zinc-500 tracking-widest">CONTROL</span>
        <span className={`text-xs font-bold tracking-wider ${running ? "text-green-400 animate-pulse" : busy ? "text-yellow-400 animate-pulse" : "text-zinc-400"}`}>
          {PHASE_LABEL[phase]}
        </span>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Btn label="SETUP"      onClick={onSetup}  disabled={busy || running || phase === "capped" || phase === "done" || !hasKey} color="violet" />
        <Btn label="FIRE"       onClick={onFire}   disabled={busy || running || phase !== "capped"} color="green" />
        <Btn label="PAUSE"      onClick={onStop}   disabled={!running} color="yellow" />
        <Btn label="RESET" onClick={onReset} disabled={busy || running || phase === "idle"} color="red" title="Withdraws funds, revokes all caps, then clears session" />
      </div>

      {stats.totalTx > 0 && (
        <div className="grid grid-cols-4 gap-3 text-center text-[11px]">
          <Stat label="VOLUME"   value={formatMist(stats.volumeMist)}       color="text-blue-400"   />
          <Stat label="TX TOTAL" value={stats.totalTx}                        color="text-violet-400" />
          <Stat label="TX/S"     value={stats.txPerSec ? `${stats.txPerSec}` : "..."} color="text-yellow-400" />
          <Stat label="ACTIVE"   value={stats.active}                         color="text-green-400"  />
        </div>
      )}

      {phase === "capped" && (
        <p className="text-[10px] text-zinc-600">
          Caps issued. Press FIRE to start the swarm.
        </p>
      )}
    </div>
  );
}

function Btn({ label, onClick, disabled, color, title }: {
  label: string; onClick: () => void; disabled: boolean; title?: string;
  color: "violet" | "green" | "yellow" | "red" | "zinc";
}) {
  const colors = {
    violet: "bg-violet-800 hover:bg-violet-600 text-violet-100 disabled:bg-violet-950 disabled:text-violet-800",
    green:  "bg-green-800  hover:bg-green-600  text-green-100  disabled:bg-green-950  disabled:text-green-800",
    yellow: "bg-yellow-800 hover:bg-yellow-600 text-yellow-100 disabled:bg-yellow-950 disabled:text-yellow-800",
    red:    "bg-red-800    hover:bg-red-600    text-red-100    disabled:bg-red-950    disabled:text-red-800",
    zinc:   "bg-zinc-800   hover:bg-zinc-600   text-zinc-100   disabled:bg-zinc-900   disabled:text-zinc-600",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`text-xs font-bold tracking-widest px-4 py-2 rounded transition-colors ${colors[color]} disabled:cursor-not-allowed`}
    >
      {label}
    </button>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div>
      <div className="text-zinc-600 text-[9px] tracking-widest">{label}</div>
      <div className={`text-base font-bold ${color}`}>{value}</div>
    </div>
  );
}
