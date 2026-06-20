import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SWARM_SIZE, AGENT_GAS_MIST, PAYMENT_MIST, SPEND_LIMIT } from "./config.js";
import { addr, fundAllAgents, issueAllCaps, pay, revoke } from "./actions.js";

function fmt(mist: bigint) { return `${Number(mist) / 1e9} SUI`; }
function short(a: string)  { return `${a.slice(0, 6)}…${a.slice(-4)}`; }
function line()             { console.log("─".repeat(64)); }

export async function runSwarm(owner: Ed25519Keypair): Promise<void> {
  const n = SWARM_SIZE;
  console.log(`\nSwarm size : ${n} agents`);
  console.log(`Spend cap  : ${fmt(SPEND_LIMIT)} / agent`);
  console.log(`Payment    : ${fmt(PAYMENT_MIST)} / agent`);
  line();

  // ── 1. Generate keypairs ──────────────────────────────────────────────────
  const agents = Array.from({ length: n }, () => new Ed25519Keypair());
  const payees = Array.from({ length: n }, () => new Ed25519Keypair());

  // ── 2. Fund all agents in one PTB ────────────────────────────────────────
  process.stdout.write(`[1/4] Funding ${n} agents in one PTB ... `);
  await fundAllAgents(owner, agents.map(addr), AGENT_GAS_MIST, SPEND_LIMIT + 1_000_000n);
  console.log("✓");

  // ── 3. Issue N caps in one PTB ────────────────────────────────────────────
  process.stdout.write(`[2/4] Issuing ${n} SpendingCaps in one PTB ... `);
  const capIds = await issueAllCaps(owner, agents.map(addr), SPEND_LIMIT);
  console.log("✓");
  capIds.forEach((id, i) =>
    console.log(`      Agent ${i + 1}  ${short(addr(agents[i]))}  cap → ${short(id)}`),
  );

  // ── 4. All agents pay concurrently ────────────────────────────────────────
  line();
  // Brief wait for freshly created coin objects to be indexed by the RPC node.
  await new Promise((r) => setTimeout(r, 3000));
  console.log(`[3/4] FIRE — ${n} agents paying concurrently:\n`);

  const completed: number[] = [];
  const failed:    number[] = [];
  const t0 = Date.now();

  const tasks = agents.map((agent, i) =>
    pay(agent, capIds[i], addr(payees[i]), PAYMENT_MIST)
      .then(() => {
        completed.push(i);
        const ms = Date.now() - t0;
        console.log(`      ✓ Agent ${i + 1}  ${short(addr(agent))}  +${ms}ms`);
      })
      .catch((err: unknown) => {
        failed.push(i);
        const ms = Date.now() - t0;
        console.log(`      ✗ Agent ${i + 1}  ${short(addr(agent))}  +${ms}ms  ${String(err).slice(0, 60)}`);
      }),
  );

  await Promise.all(tasks);
  const elapsed = Date.now() - t0;

  console.log(`\n      ${completed.length}/${n} succeeded  |  wall time: ${elapsed}ms`);

  // ── 5. Live revocation ────────────────────────────────────────────────────
  line();
  const targetIdx = 0;
  const targetAgent = agents[targetIdx];
  const targetCap   = capIds[targetIdx];

  console.log(`[4/4] Revoking Agent 1's cap live (${short(targetCap)}) ...`);
  await revoke(owner, targetCap);
  console.log("      ✓ Cap revoked on-chain\n");

  process.stdout.write("      Agent 1 attempts payment with revoked cap ... ");
  try {
    await pay(targetAgent, targetCap, addr(payees[targetIdx]), PAYMENT_MIST);
    console.log("✗  (should have failed!)");
  } catch {
    console.log("✓  correctly rejected (ECapRevoked)");
  }

  line();
  console.log("Swarm demo complete.");
}
