module jetpack::jetpack {
    use sui::coin::Coin;
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use sui::event;

    // ── Errors ──────────────────────────────────────────────────────────────
    const ECapExpired: u64        = 0;
    const ECapExhausted: u64      = 1;
    const EUnauthorizedPayee: u64 = 2;
    const ENotOwner: u64          = 3;
    const ENotAgent: u64          = 4;
    const ECapRevoked: u64        = 5;

    // ── Core object ─────────────────────────────────────────────────────────

    /// A scoped spending capability shared between owner and agent.
    /// Shared so the owner can revoke it without needing agent co-operation.
    /// Each cap is a distinct shared object — parallel agents never contend.
    public struct SpendingCap has key, store {
        id: UID,
        /// Address that issued this cap (can revoke it).
        owner: address,
        /// Address of the agent authorised to spend.
        agent: address,
        /// Maximum total spend allowed (in MIST).
        spend_limit: u64,
        /// Running total of what has been spent.
        spent: u64,
        /// Unix timestamp (ms) after which the cap is invalid. 0 = no expiry.
        expires_at: u64,
        /// If non-empty, only these payees are allowed.
        allowed_payees: vector<address>,
        /// Set to true by revoke(); pay() rejects revoked caps immediately.
        revoked: bool,
    }

    // ── Events ───────────────────────────────────────────────────────────────

    public struct CapIssued has copy, drop {
        cap_id: ID,
        owner: address,
        agent: address,
        spend_limit: u64,
        expires_at: u64,
    }

    public struct PaymentMade has copy, drop {
        cap_id: ID,
        from: address,
        to: address,
        amount: u64,
        remaining: u64,
    }

    public struct CapRevoked has copy, drop {
        cap_id: ID,
        owner: address,
        agent: address,
    }

    // ── Entry functions ──────────────────────────────────────────────────────

    /// Owner issues a SpendingCap.
    /// The cap becomes a shared object so owner can revoke it at any time.
    public fun issue_cap(
        agent: address,
        spend_limit: u64,
        expires_at: u64,
        allowed_payees: vector<address>,
        ctx: &mut TxContext,
    ) {
        let owner = ctx.sender();
        let cap = SpendingCap {
            id: object::new(ctx),
            owner,
            agent,
            spend_limit,
            spent: 0,
            expires_at,
            allowed_payees,
            revoked: false,
        };
        event::emit(CapIssued {
            cap_id: object::id(&cap),
            owner,
            agent,
            spend_limit,
            expires_at,
        });
        transfer::share_object(cap);
    }

    /// Agent spends from the cap.
    public fun pay(
        cap: &mut SpendingCap,
        coin: &mut Coin<SUI>,
        payee: address,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == cap.agent, ENotAgent);
        assert!(!cap.revoked, ECapRevoked);

        if (cap.expires_at > 0) {
            assert!(clock::timestamp_ms(clock) < cap.expires_at, ECapExpired);
        };

        assert!(cap.spent + amount <= cap.spend_limit, ECapExhausted);

        if (!cap.allowed_payees.is_empty()) {
            assert!(cap.allowed_payees.contains(&payee), EUnauthorizedPayee);
        };

        cap.spent = cap.spent + amount;

        let payment = coin.split(amount, ctx);
        transfer::public_transfer(payment, payee);

        event::emit(PaymentMade {
            cap_id: object::id(cap),
            from: cap.agent,
            to: payee,
            amount,
            remaining: cap.spend_limit - cap.spent,
        });
    }

    /// Owner revokes the cap. Sets the revoked flag; pay() will reject it instantly.
    public fun revoke(cap: &mut SpendingCap, ctx: &TxContext) {
        assert!(ctx.sender() == cap.owner, ENotOwner);
        cap.revoked = true;
        event::emit(CapRevoked {
            cap_id: object::id(cap),
            owner: cap.owner,
            agent: cap.agent,
        });
    }

    // ── View helpers ─────────────────────────────────────────────────────────

    public fun remaining(cap: &SpendingCap): u64 {
        cap.spend_limit - cap.spent
    }

    public fun is_expired(cap: &SpendingCap, clock: &Clock): bool {
        cap.expires_at > 0 && clock::timestamp_ms(clock) >= cap.expires_at
    }

    public fun is_revoked(cap: &SpendingCap): bool {
        cap.revoked
    }
}
