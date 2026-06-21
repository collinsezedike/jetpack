import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { NETWORK, PACKAGE_ID, CLOCK } from "./config.js";

export const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

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

export async function fundAllAgents(
  from: Ed25519Keypair,
  agents: string[],
  gasMist: bigint,
  paymentMist: bigint,
): Promise<void> {
  const tx = new Transaction();
  const amounts = agents.flatMap(() => [gasMist, paymentMist]);
  const coins = tx.splitCoins(tx.gas, amounts);
  agents.forEach((to, i) => {
    tx.transferObjects([coins[i * 2], coins[i * 2 + 1]], to);
  });
  const r = await client.signAndExecuteTransaction({
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
      target: `${PACKAGE_ID}::jetpack::issue_cap`,
      arguments: [
        tx.pure.address(agentAddr),
        tx.pure.u64(spendLimit),
        tx.pure.u64(0n),
        tx.pure(bcs.vector(bcs.Address).serialize([])),
      ],
    });
  });
  const r = await client.signAndExecuteTransaction({
    signer: owner, transaction: tx,
    options: { showEvents: true, showEffects: true },
  });
  assertOk(r, "issue_all_caps");

  const agentToCap = new Map<string, string>();
  for (const ev of r.events ?? []) {
    const fields = ev.parsedJson as { cap_id: string; agent: string } | undefined;
    if (fields?.cap_id && fields?.agent) {
      agentToCap.set(fields.agent, `0x${fields.cap_id.replace(/^0x/i, "")}`);
    }
  }

  return agents.map((a, i) => {
    const capId = agentToCap.get(a);
    if (!capId) throw new Error(`No CapIssued event for agent ${i + 1}`);
    return capId;
  });
}

export async function pay(
  agent: Ed25519Keypair,
  capId: string,
  payeeAddress: string,
  amountMist: bigint,
): Promise<string> {
  const coins = await client.getCoins({ owner: addr(agent), coinType: "0x2::sui::SUI" });
  const sorted = [...coins.data].sort((a, b) =>
    BigInt(a.balance) < BigInt(b.balance) ? -1 : 1,
  );
  const paymentCoin = sorted.find((c) => BigInt(c.balance) >= amountMist);
  const gasCoin     = [...sorted].reverse().find((c) => c.coinObjectId !== paymentCoin?.coinObjectId);
  if (!paymentCoin) throw new Error(`Insufficient coins for ${addr(agent).slice(0, 8)}`);
  if (!gasCoin)     throw new Error(`No separate gas coin for ${addr(agent).slice(0, 8)}`);

  const tx = new Transaction();
  tx.setGasBudget(5_000_000n);
  tx.setGasPayment([{
    objectId: gasCoin.coinObjectId,
    version:  gasCoin.version,
    digest:   gasCoin.digest,
  }]);
  tx.moveCall({
    target: `${PACKAGE_ID}::jetpack::pay`,
    arguments: [
      tx.object(capId),
      tx.object(paymentCoin.coinObjectId),
      tx.pure.address(payeeAddress),
      tx.pure.u64(amountMist),
      tx.object(CLOCK),
    ],
  });
  const r = await client.signAndExecuteTransaction({
    signer: agent, transaction: tx, options: { showEffects: true },
  });
  assertOk(r, "pay");
  return r.digest;
}

export async function revoke(owner: Ed25519Keypair, capId: string): Promise<void> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::jetpack::revoke`,
    arguments: [tx.object(capId)],
  });
  const r = await client.signAndExecuteTransaction({
    signer: owner, transaction: tx, options: { showEffects: true },
  });
  assertOk(r, "revoke");
}

export async function withdrawAgent(
  agent: Ed25519Keypair,
  ownerAddress: string,
): Promise<string | null> {
  const coins = await client.getCoins({ owner: addr(agent), coinType: "0x2::sui::SUI" });
  if (coins.data.length === 0) return null;
  const sorted = [...coins.data].sort((a, b) =>
    BigInt(b.balance) > BigInt(a.balance) ? 1 : -1,
  );
  const gasCoin   = sorted[0];
  const restCoins = sorted.slice(1);
  const tx = new Transaction();
  tx.setGasBudget(3_000_000n);
  tx.setGasPayment([{ objectId: gasCoin.coinObjectId, version: gasCoin.version, digest: gasCoin.digest }]);
  if (restCoins.length > 0) {
    tx.transferObjects(restCoins.map((c) => tx.object(c.coinObjectId)), ownerAddress);
  }
  tx.transferObjects([tx.gas], ownerAddress);
  const r = await client.signAndExecuteTransaction({
    signer: agent, transaction: tx, options: { showEffects: true },
  });
  assertOk(r, "withdraw");
  return r.digest;
}
