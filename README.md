# Jetpack

Scoped spending capabilities for AI agents on Sui.

Jetpack lets you delegate on-chain payment authority to an AI agent without handing it your wallet. You issue a `SpendingCap` that encodes exactly what the agent is allowed to spend: a total limit, an optional expiry, and an optional list of approved payees. The agent can only call `pay()` within those bounds. You can revoke the cap at any time, from any client, and the agent is cut off instantly.

---

## Why this matters

AI agents that move money are becoming real infrastructure. The current options are bad:

- **Give the agent your private key.** Unlimited authority. One compromise means total loss.
- **Route every payment through a co-signing server.** Adds latency, centralises risk, and creates a single point of failure.

Jetpack introduces a third option: a programmable, revocable, on-chain spending policy. The agent holds its own keypair. The owner controls what that keypair is allowed to do.

---

## Why Sui

Two properties of Sui are load-bearing here.

**Shared objects with independent IDs.** Each `SpendingCap` is its own shared object. When 20 agents pay simultaneously, each transaction touches a different cap. There is no shared global state and no sequencing bottleneck. Sui executes them in parallel.

**Live revocation without agent cooperation.** Because the cap is shared (not agent-owned), the owner can mutate it directly. `revoke()` flips a flag on the cap. Any subsequent `pay()` call aborts with `ECapRevoked`. The agent does not need to do anything; it simply loses the ability to spend.

---

## Contract design

### `SpendingCap`

```
SpendingCap {
    id: UID,
    owner: address,       // who issued the cap (can revoke)
    agent: address,       // who is allowed to call pay()
    spend_limit: u64,     // total budget in MIST
    spent: u64,           // running total
    expires_at: u64,      // unix ms; 0 means no expiry
    allowed_payees: vector<address>,  // empty means any payee
    revoked: bool,
}
```

The cap is a shared object. This is intentional. Agent-owned objects can only be used by the agent, which would make owner-side revocation impossible without a separate mechanism.

### Functions

| Function | Caller | What it does |
|---|---|---|
| `issue_cap(agent, spend_limit, expires_at, allowed_payees)` | owner | Creates and shares a new cap |
| `pay(cap, coin, payee, amount, clock)` | agent | Validates policy, splits coin, transfers to payee |
| `revoke(cap)` | owner | Sets `revoked = true`; future pay() calls abort |
| `remaining(cap)` | anyone | Returns `spend_limit - spent` |
| `is_expired(cap, clock)` | anyone | True if past expiry |
| `is_revoked(cap)` | anyone | True if revoked |

### Policy checks in `pay()`

1. Caller must be `cap.agent`
2. Cap must not be revoked
3. If `expires_at > 0`, current time must be before it
4. `spent + amount` must not exceed `spend_limit`
5. If `allowed_payees` is non-empty, `payee` must be in the list

All checks abort with typed error codes.

### Error codes

| Code | Constant | Meaning |
|---|---|---|
| 0 | `ECapExpired` | Past expiry timestamp |
| 1 | `ECapExhausted` | Would exceed spend limit |
| 2 | `EUnauthorizedPayee` | Payee not in allowlist |
| 3 | `ENotOwner` | Revoke caller is not the owner |
| 4 | `ENotAgent` | Pay caller is not the agent |
| 5 | `ECapRevoked` | Cap has been revoked |

### Events

- `CapIssued { cap_id, owner, agent, spend_limit, expires_at }` -- emitted by `issue_cap()`
- `PaymentMade { cap_id, from, to, amount, remaining }` -- emitted by `pay()`
- `CapRevoked { cap_id, owner, agent }` -- emitted by `revoke()`

---

## Repository layout

```
jetpack/
  move/                  Move package
    sources/
      jetpack.move       Core contract
    tests/
      jetpack_tests.move 13 unit tests
    Move.toml

  demo/                  Node.js swarm demo (20 agents, concurrent)
    src/
      config.ts          Package ID, network, tuning constants
      actions.ts         fund, issue_cap, pay, revoke primitives
      swarm.ts           4-phase orchestration: fund -> cap -> fire -> revoke
      index.ts           Entry point
    package.json
    tsconfig.json

  app/                   Vite + React + Tailwind visualiser
    src/
      App.tsx            Main state machine and layout
      actions.ts         Browser-compatible version of demo/actions.ts
      config.ts          Shared constants
      types.ts           AgentState, AgentStatus, LogEntry
      components/
        AgentCard.tsx    Per-agent status card with flash animations
        AgentGrid.tsx    4x5 responsive grid
        ControlPanel.tsx SETUP / FIRE / REVOKE ALL / RESET + stats
        EventFeed.tsx    Auto-scrolling timestamped event log
    index.html
    package.json
    vite.config.ts
    tailwind.config.js
```

---

## Testnet deployment

```
Package:  0xd16d4b8faa7a0ec41b08cea5c570597640bbde339cbc2c384d0b9d5315ec85c6
Network:  Sui Testnet
Clock:    0x6
```

---

## Quickstart

### Prerequisites

- Sui CLI 1.59+
- Node.js 20+
- pnpm 8+

### 1. Build and test the Move contract

```sh
cd move
sui move build
sui move test
```

All 13 tests should pass.

### 2. Deploy

```sh
sui client publish --gas-budget 100000000
```

Copy the published package ID and update `PACKAGE_ID` in both `demo/src/config.ts` and `app/src/config.ts`.

### 3. Run the swarm demo (CLI)

Get testnet SUI from the faucet at `https://faucet.sui.io`, then:

```sh
cd demo
pnpm install
pnpm start
```

The demo runs four phases:

1. **Fund** -- single PTB splits gas into 20 agent wallets (2 coins each: one for gas, one for payment)
2. **Issue** -- single PTB issues 20 `SpendingCap` objects, one per agent
3. **Fire** -- all 20 agents call `pay()` concurrently via `Promise.all`; each touches its own cap, so Sui executes them in parallel
4. **Revoke** -- owner revokes the first cap; the demo confirms the agent is rejected on retry

### 4. Run the visualiser

```sh
cd app
pnpm install
pnpm dev
```

Open `http://localhost:5173`. Paste the base64 key from your keystore:

```sh
cat ~/.sui/sui_config/sui.keystore
# paste the quoted string (without the outer quotes) into the key field
```

Use the SETUP button to fund agents and issue caps, FIRE to trigger concurrent payments, and REVOKE ALL to cut off every paid agent.

---

## Implementation notes

**Two coins per agent.** Sui forbids using the same coin object as both a Move argument and a gas payment. Each agent is funded with two separate coin objects: one for gas, one to pass into `pay()`.

**Batch PTBs for funding and cap issuance.** The owner wallet has one gas coin. Funding 20 agents sequentially would require 20 separate transactions, and firing them in parallel would cause object lock conflicts. Instead, a single Programmable Transaction Block splits and distributes all funding in one transaction. Cap issuance works the same way.

**Event-based cap assignment.** After the batch `issue_cap` PTB, `objectChanges` in the response lists new shared objects but does not preserve the order of Move calls. Instead, Jetpack reads the `CapIssued` events, each of which carries the `agent` address, and builds the correct `agent -> capId` map from those.

**Shared object and parallel execution.** When 20 agents fire simultaneously, each transaction only locks its own `SpendingCap`. Sui's object-level locking means these transactions are independent and the validator can process them in parallel, rather than sequencing all shared-object transactions through a single queue.

---

## Testing

```sh
cd move && sui move test
```

| Test | Covers |
|---|---|
| `test_issue_cap_creates_shared_object` | Cap is shared and not revoked on creation |
| `test_partial_spend` | `remaining()` decrements correctly |
| `test_two_sequential_payments` | Multiple pays within limit work |
| `test_payment_to_allowed_payee` | Allowlist pass |
| `test_owner_revokes_cap` | `revoke()` sets flag |
| `test_not_expired_with_zero_expiry` | `expires_at = 0` means no expiry |
| `test_is_expired_past_deadline` | Clock past expiry returns true |
| `test_overspend_aborts` | `ECapExhausted (1)` |
| `test_expired_cap_aborts` | `ECapExpired (0)` |
| `test_disallowed_payee_aborts` | `EUnauthorizedPayee (2)` |
| `test_wrong_agent_aborts` | `ENotAgent (4)` |
| `test_wrong_revoker_aborts` | `ENotOwner (3)` |
| `test_pay_on_revoked_cap_aborts` | `ECapRevoked (5)` |

---

## License

MIT
