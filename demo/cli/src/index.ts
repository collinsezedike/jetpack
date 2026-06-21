import { loadOwnerKeypair, addr, revoke, withdrawAgent } from "./actions.js";
import { runSwarm, Agent } from "./swarm.js";

const RESTORE = "\x1b[?1049l\x1b[?25h"; // exit alt screen, show cursor

async function cleanup(
  agents: Agent[],
  owner: ReturnType<typeof loadOwnerKeypair>,
  ownerAddress: string,
): Promise<void> {
  process.stdout.write(RESTORE);

  const live = agents.filter(a => a.status !== "dead" && a.capId);
  if (live.length === 0) {
    console.log("\nAll agents exhausted. Nothing to withdraw.");
    return;
  }

  console.log(`\n\x1b[33mWithdrawing funds from ${live.length} agents...\x1b[0m`);
  for (const agent of live) {
    try {
      await withdrawAgent(agent.kp, ownerAddress);
      console.log(`  \x1b[32m✓\x1b[0m A${agent.index + 1} funds returned`);
    } catch {
      console.log(`  \x1b[90m- A${agent.index + 1} nothing to withdraw\x1b[0m`);
    }
    try {
      await revoke(owner, agent.capId);
    } catch {
      // cap may already be exhausted
    }
  }
  console.log("\x1b[32mDone.\x1b[0m");
}

async function main(): Promise<void> {
  const owner        = loadOwnerKeypair();
  const ownerAddress = addr(owner);

  const signal = { stop: false };
  let agents: Agent[] = [];

  // Ctrl+C: graceful stop. Repeated presses are ignored -- funds must be
  // withdrawn before exit to avoid stranding agent gas coins on-chain.
  let stopping = false;
  process.on("SIGINT", () => {
    if (stopping) {
      process.stdout.write("\r\x1b[K\x1b[33mPlease wait — withdrawing funds before exit.\x1b[0m\n");
      return;
    }
    stopping = true;
    signal.stop = true;
  });

  try {
    agents = await runSwarm(owner, ownerAddress, signal);
  } finally {
    await cleanup(agents, owner, ownerAddress);
  }
}

main().catch((err) => {
  process.stdout.write(RESTORE);
  console.error(err);
  process.exit(1);
});
