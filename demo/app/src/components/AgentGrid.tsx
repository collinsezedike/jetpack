import { motion } from "framer-motion";
import { AgentState } from "../types";
import AgentCard from "./AgentCard";

interface Props {
  agents: AgentState[];
}

export default function AgentGrid({ agents }: Props) {
  const sorted = [...agents].sort((a, b) => {
    const diff = b.received - a.received;
    if (diff > 0n) return 1;
    if (diff < 0n) return -1;
    return 0;
  });

  return (
    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
      {sorted.map((a, rank) => (
        <motion.div
          key={a.index}
          layout
          transition={{ type: "spring", stiffness: 350, damping: 30 }}
        >
          <AgentCard agent={a} rank={rank + 1} />
        </motion.div>
      ))}
    </div>
  );
}
