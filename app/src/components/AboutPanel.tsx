export default function AboutPanel() {
  return (
    <div className="space-y-8 text-sm leading-relaxed text-zinc-300">

      <section className="space-y-3">
        <h2 className="text-white font-bold text-base tracking-tight">What is Jetpack?</h2>
        <p>
          Jetpack is a scoped spending capability protocol for AI agents on Sui. Instead of giving an agent your private key, you issue it a <code className="text-violet-300 bg-violet-950 px-1 rounded">SpendingCap</code>: a shared object that encodes exactly what the agent is allowed to spend. The agent can only call <code className="text-violet-300 bg-violet-950 px-1 rounded">pay()</code> within those bounds. You can revoke the cap at any time, and the effect is immediate.
        </p>
        <p>
          Each cap is its own Sui object. When 20 agents transact simultaneously, each transaction touches a different cap, so there is no shared state and no sequencing bottleneck. Sui's object-level locking allows them to execute in parallel.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-white font-bold text-base tracking-tight">The Economic Simulation</h2>
        <p>
          This demo runs a mini economy inspired by Robert Axelrod's iterated prisoner's dilemma tournament. Each of the 20 agents is assigned a strategy that determines who it pays each round. Agents with caps pay each other continuously until their caps are exhausted or revoked. Received SUI can be used as gas, so money circulates.
        </p>
        <div className="rounded border border-zinc-800 bg-zinc-950 p-4 space-y-3 text-[12px]">
          <Strategy name="Generous" color="text-blue-400" badge="GEN">
            Picks a random agent and pays it every round. Cooperative and predictable. Strong in
            environments where others reciprocate, fragile against purely selfish actors.
          </Strategy>
          <Strategy name="Reciprocal" color="text-violet-400" badge="REC">
            Remembers the last agent that paid it and pays them back next round. Falls back to
            random on first move. This is tit-for-tat: the canonical winning strategy in Axelrod's
            original tournament, rewarding cooperation and punishing defection.
          </Strategy>
          <Strategy name="Chaotic" color="text-orange-400" badge="CHA">
            Pays a random agent 75% of the time; skips the other 25%. Unpredictable. Conserves
            cap budget on skip rounds, but breaks reciprocal relationships by appearing to defect
            at random.
          </Strategy>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-white font-bold text-base tracking-tight">Contract Functions</h2>
        <div className="rounded border border-zinc-800 bg-zinc-950 divide-y divide-zinc-800 text-[12px] font-mono">
          {[
            { fn: "issue_cap(agent, limit, expires_at, payees)", who: "owner", what: "Creates a new SpendingCap shared object." },
            { fn: "pay(cap, coin, payee, amount, clock)",        who: "agent", what: "Validates policy, splits coin, sends payment. Reverts on any violation." },
            { fn: "revoke(cap)",                                 who: "owner", what: "Sets revoked = true. All future pay() calls on this cap revert instantly." },
            { fn: "remaining(cap)",                              who: "anyone", what: "Returns spend_limit minus spent." },
          ].map(({ fn, who, what }) => (
            <div key={fn} className="px-4 py-3 grid grid-cols-[1fr,auto] gap-4">
              <div>
                <div className="text-violet-300">{fn}</div>
                <div className="text-zinc-500 mt-1 font-sans">{what}</div>
              </div>
              <div className="text-[10px] text-zinc-600 self-start pt-0.5 shrink-0">{who}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-white font-bold text-base tracking-tight">Spending Policy</h2>
        <p>Every payment is checked against four rules enforced in Move:</p>
        <ol className="list-decimal list-inside space-y-1 text-zinc-400 text-[12px]">
          <li>Caller must be the cap's designated agent address.</li>
          <li>Cap must not be revoked.</li>
          <li>If <code className="text-violet-300">expires_at</code> is set, current time must be before it.</li>
          <li>Running total of <code className="text-violet-300">spent + amount</code> must not exceed <code className="text-violet-300">spend_limit</code>.</li>
          <li>If <code className="text-violet-300">allowed_payees</code> is non-empty, payee must be in the list.</li>
        </ol>
        <p className="text-zinc-500 text-[12px]">
          All checks run atomically on-chain. There is no off-chain oracle or co-signer. The contract is the policy engine.
        </p>
      </section>

    </div>
  );
}

function Strategy({
  name, color, badge, children,
}: {
  name: string; color: string; badge: string; children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className={`${color} font-bold shrink-0 w-8 text-right`}>{badge}</span>
      <div>
        <span className={`${color} font-bold`}>{name}: </span>
        <span className="text-zinc-400">{children}</span>
      </div>
    </div>
  );
}
