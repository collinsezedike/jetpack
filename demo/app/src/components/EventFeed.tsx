import { useEffect, useRef } from "react";
import { LogEntry } from "../types";

const KIND_STYLE = {
  info:    "text-zinc-400",
  success: "text-green-400",
  error:   "text-red-400",
  warn:    "text-yellow-400",
};

const KIND_PREFIX = {
  info:    "·",
  success: "✓",
  error:   "✕",
  warn:    "⚠",
};

interface Props { entries: LogEntry[]; }

export default function EventFeed({ entries }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div className="h-64 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 p-3 text-[11px] space-y-0.5 font-mono">
      {entries.length === 0 && (
        <div className="text-zinc-700">awaiting events…</div>
      )}
      {entries.map((e) => (
        <div key={e.id} className={`flex gap-2 ${KIND_STYLE[e.kind]}`}>
          <span className="opacity-40 shrink-0">
            {new Date(e.ts).toISOString().slice(11, 23)}
          </span>
          <span className="shrink-0">{KIND_PREFIX[e.kind]}</span>
          <span className="break-all">{e.message}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
