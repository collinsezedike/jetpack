import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import type { Signer } from "@mysten/sui/cryptography";
import {
  JetpackClientOptions,
  IssueCapParams,
  PayParams,
  IssueCapResult,
  TxResult,
  SpendingCap,
} from "./types.js";
import { parseError } from "./errors.js";

const TESTNET_PACKAGE_ID = "0xd16d4b8faa7a0ec41b08cea5c570597640bbde339cbc2c384d0b9d5315ec85c6";
const CLOCK_ID           = "0x6";

export class JetpackClient {
  /** The underlying Sui RPC client. Exposed for advanced usage. */
  readonly suiClient: SuiJsonRpcClient;
  readonly packageId: string;

  constructor(options: JetpackClientOptions = {}) {
    const network  = options.network ?? "testnet";
    const rpcUrl   = options.rpcUrl  ?? getJsonRpcFullnodeUrl(network);
    this.suiClient = new SuiJsonRpcClient({ url: rpcUrl, network });
    this.packageId = options.packageId ?? TESTNET_PACKAGE_ID;
  }

  /**
   * Owner issues a SpendingCap granting an agent the right to spend up to
   * `spendLimit` MIST. The cap becomes a shared object so the owner can
   * revoke it at any time without the agent's cooperation.
   */
  async issueCap(signer: Signer, params: IssueCapParams): Promise<IssueCapResult> {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.packageId}::jetpack::issue_cap`,
      arguments: [
        tx.pure.address(params.agent),
        tx.pure.u64(params.spendLimit),
        tx.pure.u64(params.expiresAt ?? 0n),
        tx.pure(bcs.vector(bcs.Address).serialize(params.allowedPayees ?? [])),
      ],
    });

    const result = await this.suiClient.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: { showEvents: true, showEffects: true },
    });
    this.assertOk(result, "issueCap");

    for (const ev of result.events ?? []) {
      const fields = ev.parsedJson as { cap_id?: string; agent?: string } | undefined;
      if (fields?.cap_id && fields?.agent === params.agent) {
        return {
          capId:  `0x${fields.cap_id.replace(/^0x/i, "")}`,
          digest: result.digest,
        };
      }
    }

    throw new Error("issueCap: CapIssued event not found in transaction result");
  }

  /**
   * Agent spends `amount` MIST from the cap, transferring it to `payee`.
   * Throws a typed JetpackError if the cap is revoked, exhausted, expired,
   * or the payee is not on the allowlist.
   */
  async pay(signer: Signer, params: PayParams): Promise<TxResult> {
    const signerAddress = signer.getPublicKey().toSuiAddress();
    const { data: coins } = await this.suiClient.getCoins({
      owner:    signerAddress,
      coinType: "0x2::sui::SUI",
    });

    if (coins.length === 0) throw new Error("pay: No SUI coins found for signer");

    const sorted       = [...coins].sort((a, b) => (BigInt(a.balance) < BigInt(b.balance) ? -1 : 1));
    const paymentCoin  = sorted.find(c => BigInt(c.balance) >= params.amount);
    const gasCoin      = [...sorted].reverse().find(c => c.coinObjectId !== paymentCoin?.coinObjectId);

    if (!paymentCoin) throw new Error("pay: Insufficient balance to cover payment amount");
    if (!gasCoin)     throw new Error("pay: Need at least two coin objects (one for payment, one for gas)");

    const tx = new Transaction();
    tx.setGasBudget(5_000_000n);
    tx.setGasPayment([{
      objectId: gasCoin.coinObjectId,
      version:  gasCoin.version,
      digest:   gasCoin.digest,
    }]);
    tx.moveCall({
      target: `${this.packageId}::jetpack::pay`,
      arguments: [
        tx.object(params.capId),
        tx.object(paymentCoin.coinObjectId),
        tx.pure.address(params.payee),
        tx.pure.u64(params.amount),
        tx.object(CLOCK_ID),
      ],
    });

    try {
      const result = await this.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true },
      });
      this.assertOk(result, "pay");
      return { digest: result.digest };
    } catch (err) {
      throw parseError(err) ?? err;
    }
  }

  /**
   * Owner revokes a SpendingCap. After revocation, any call to `pay()`
   * with this cap will throw a `CapRevokedError`.
   */
  async revoke(signer: Signer, capId: string): Promise<TxResult> {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.packageId}::jetpack::revoke`,
      arguments: [tx.object(capId)],
    });

    try {
      const result = await this.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true },
      });
      this.assertOk(result, "revoke");
      return { digest: result.digest };
    } catch (err) {
      throw parseError(err) ?? err;
    }
  }

  /** Fetch the current on-chain state of a SpendingCap. */
  async getCap(capId: string): Promise<SpendingCap> {
    const obj = await this.suiClient.getObject({
      id:      capId,
      options: { showContent: true },
    });

    if (!obj.data?.content || obj.data.content.dataType !== "moveObject") {
      throw new Error(`getCap: Object ${capId} not found or is not a Move object`);
    }

    const f = obj.data.content.fields as Record<string, unknown>;
    return {
      id:            capId,
      owner:         f.owner         as string,
      agent:         f.agent         as string,
      spendLimit:    BigInt(f.spend_limit  as string),
      spent:         BigInt(f.spent        as string),
      expiresAt:     BigInt(f.expires_at   as string),
      allowedPayees: (f.allowed_payees as string[]) ?? [],
      revoked:       f.revoked as boolean,
    };
  }

  private assertOk(
    result: { effects?: { status?: { status: string; error?: string } } | null },
    label: string,
  ): void {
    const s = result.effects?.status;
    if (s?.status !== "success") throw new Error(`${label} failed: ${s?.error ?? "unknown"}`);
  }
}
