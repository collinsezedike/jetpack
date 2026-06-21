import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { JetpackClient } from "jetpack-sui";
import { NETWORK } from "./config.js";

export const jetpack = new JetpackClient({ network: NETWORK });
export const { suiClient } = jetpack;

export function loadOwnerKeypair(): Ed25519Keypair {
  const keystorePath = join(homedir(), ".sui", "sui_config", "sui.keystore");
  const keys: string[] = JSON.parse(readFileSync(keystorePath, "utf8"));
  if (keys.length === 0) throw new Error("Keystore is empty");
  const raw = Buffer.from(keys[0], "base64");
  return Ed25519Keypair.fromSecretKey(raw.subarray(1));
}

export function addr(kp: Ed25519Keypair): string {
  return kp.getPublicKey().toSuiAddress();
}

function assertOk(
  result: { effects?: { status?: { status: string; error?: string } } | null },
  label: string,
) {
  const s = result.effects?.status;
  if (s?.status !== "success") throw new Error(`${label}: ${s?.error ?? "failed"}`);
}

// ── Demo utilities (batch ops, not protocol primitives) ───────────────────────

export async function fundAllAgents(
  from: Ed25519Keypair,
  agents: string[],
  gasMist: bigint,
  paymentMist: bigint,
): Promise<void> {
  const tx = new Transaction();
  const amounts = agents.flatMap(() => [gasMist, paymentMist]);
  const coins = tx.splitCoins(tx.gas, amounts);
  agents.forEach((to, i) => tx.transferObjects([coins[i * 2], coins[i * 2 + 1]], to));
  const r = await suiClient.signAndExecuteTransaction({
    signer: from, transaction: tx, options: { showEffects: true },
  });
  assertOk(r, "fund_all");
}

export async function issueAllCaps(
  owner: Ed25519Keypair,
  agents: string[],
  spendLimit: bigint,
): Promise<string[]> {
  const tx = new Transaction();
  agents.forEach((agentAddr) => {
    tx.moveCall({
      target: `${jetpack.packageId}::jetpack::issue_cap`,
      arguments: [
        tx.pure.address(agentAddr),
        tx.pure.u64(spendLimit),
        tx.pure.u64(0n),
        tx.pure(bcs.vector(bcs.Address).serialize([])),
      ],
    });
  });
  const r = await suiClient.signAndExecuteTransaction({
    signer: owner, transaction: tx, options: { showEvents: true, showEffects: true },
  });
  assertOk(r, "issue_all_caps");

  const agentToCap = new Map<string, string>();
  for (const ev of r.events ?? []) {
    const f = ev.parsedJson as { cap_id?: string; agent?: string } | undefined;
    if (f?.cap_id && f?.agent) {
      agentToCap.set(f.agent, `0x${f.cap_id.replace(/^0x/i, "")}`);
    }
  }
  return agents.map((a, i) => {
    const id = agentToCap.get(a);
    if (!id) throw new Error(`No cap event for agent ${i + 1}`);
    return id;
  });
}

export async function withdrawAgent(
  agent: Ed25519Keypair,
  ownerAddress: string,
): Promise<string | null> {
  const coins = await suiClient.getCoins({ owner: addr(agent), coinType: "0x2::sui::SUI" });
  if (coins.data.length === 0) return null;

  const sorted  = [...coins.data].sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : -1));
  const gasCoin = sorted[0];
  const rest    = sorted.slice(1);

  const tx = new Transaction();
  tx.setGasBudget(3_000_000n);
  tx.setGasPayment([{ objectId: gasCoin.coinObjectId, version: gasCoin.version, digest: gasCoin.digest }]);
  if (rest.length > 0) {
    tx.transferObjects(rest.map(c => tx.object(c.coinObjectId)), ownerAddress);
  }
  tx.transferObjects([tx.gas], ownerAddress);

  const r = await suiClient.signAndExecuteTransaction({
    signer: agent, transaction: tx, options: { showEffects: true },
  });
  assertOk(r, "withdraw");
  return r.digest;
}

// ── Protocol operations (delegated to SDK) ────────────────────────────────────

export async function pay(
  agent: Ed25519Keypair,
  capId: string,
  payeeAddress: string,
  amountMist: bigint,
): Promise<string> {
  const { digest } = await jetpack.pay(agent, { capId, payee: payeeAddress, amount: amountMist });
  return digest;
}

export async function revoke(owner: Ed25519Keypair, capId: string): Promise<void> {
  await jetpack.revoke(owner, capId);
}
