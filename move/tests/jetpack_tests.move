#[test_only]
module jetpack::jetpack_tests {
    use jetpack::jetpack::{Self, SpendingCap};
    use sui::test_scenario::{Self as ts};
    use sui::coin;
    use sui::sui::SUI;
    use sui::clock;

    const OWNER: address = @0xA;
    const AGENT: address = @0xB;
    const PAYEE: address = @0xC;
    const RANDO: address = @0xD;

    fun one_sui(): u64 { 1_000_000_000 }

    fun setup_shared_cap(
        spend_limit: u64,
        expires_at: u64,
        allowed_payees: vector<address>,
    ): ts::Scenario {
        let mut scenario = ts::begin(OWNER);
        {
            jetpack::issue_cap(AGENT, spend_limit, expires_at, allowed_payees, ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, AGENT);
        scenario
    }

    // ── Happy path ───────────────────────────────────────────────────────────

    #[test]
    fun test_issue_cap_creates_shared_object() {
        let mut s = setup_shared_cap(one_sui(), 0, vector[]);
        let cap = ts::take_shared<SpendingCap>(&s);
        assert!(!jetpack::is_revoked(&cap), 0);
        ts::return_shared(cap);
        ts::end(s);
    }

    #[test]
    fun test_partial_spend() {
        let mut s = setup_shared_cap(one_sui(), 0, vector[]);
        let mut cap = ts::take_shared<SpendingCap>(&s);
        let mut coin = coin::mint_for_testing<SUI>(one_sui(), ts::ctx(&mut s));
        let clock = clock::create_for_testing(ts::ctx(&mut s));

        jetpack::pay(&mut cap, &mut coin, PAYEE, 400_000_000, &clock, ts::ctx(&mut s));
        assert!(jetpack::remaining(&cap) == 600_000_000, 0);

        clock::destroy_for_testing(clock);
        coin::burn_for_testing(coin);
        ts::return_shared(cap);
        ts::end(s);
    }

    #[test]
    fun test_two_sequential_payments() {
        let mut s = setup_shared_cap(one_sui(), 0, vector[]);
        let mut cap = ts::take_shared<SpendingCap>(&s);
        let mut coin = coin::mint_for_testing<SUI>(one_sui(), ts::ctx(&mut s));
        let clock = clock::create_for_testing(ts::ctx(&mut s));

        jetpack::pay(&mut cap, &mut coin, PAYEE, 300_000_000, &clock, ts::ctx(&mut s));
        jetpack::pay(&mut cap, &mut coin, PAYEE, 700_000_000, &clock, ts::ctx(&mut s));
        assert!(jetpack::remaining(&cap) == 0, 0);

        clock::destroy_for_testing(clock);
        coin::burn_for_testing(coin);
        ts::return_shared(cap);
        ts::end(s);
    }

    #[test]
    fun test_payment_to_allowed_payee() {
        let mut s = setup_shared_cap(one_sui(), 0, vector[PAYEE]);
        let mut cap = ts::take_shared<SpendingCap>(&s);
        let mut coin = coin::mint_for_testing<SUI>(one_sui(), ts::ctx(&mut s));
        let clock = clock::create_for_testing(ts::ctx(&mut s));

        jetpack::pay(&mut cap, &mut coin, PAYEE, 100_000_000, &clock, ts::ctx(&mut s));

        clock::destroy_for_testing(clock);
        coin::burn_for_testing(coin);
        ts::return_shared(cap);
        ts::end(s);
    }

    #[test]
    fun test_owner_revokes_cap() {
        let mut s = setup_shared_cap(one_sui(), 0, vector[]);
        let mut cap = ts::take_shared<SpendingCap>(&s);

        ts::next_tx(&mut s, OWNER);
        jetpack::revoke(&mut cap, ts::ctx(&mut s));
        assert!(jetpack::is_revoked(&cap), 0);

        ts::return_shared(cap);
        ts::end(s);
    }

    #[test]
    fun test_not_expired_with_zero_expiry() {
        let mut s = setup_shared_cap(one_sui(), 0, vector[]);
        let cap = ts::take_shared<SpendingCap>(&s);
        let clock = clock::create_for_testing(ts::ctx(&mut s));

        assert!(!jetpack::is_expired(&cap, &clock), 0);

        clock::destroy_for_testing(clock);
        ts::return_shared(cap);
        ts::end(s);
    }

    #[test]
    fun test_is_expired_past_deadline() {
        let mut s = setup_shared_cap(one_sui(), 1_000, vector[]);
        let cap = ts::take_shared<SpendingCap>(&s);
        let mut clock = clock::create_for_testing(ts::ctx(&mut s));
        clock::set_for_testing(&mut clock, 2_000);

        assert!(jetpack::is_expired(&cap, &clock), 0);

        clock::destroy_for_testing(clock);
        ts::return_shared(cap);
        ts::end(s);
    }

    // ── Failure cases ────────────────────────────────────────────────────────

    #[test]
    #[expected_failure(abort_code = 1)]
    fun test_overspend_aborts() {
        let mut s = setup_shared_cap(one_sui(), 0, vector[]);
        let mut cap = ts::take_shared<SpendingCap>(&s);
        let mut coin = coin::mint_for_testing<SUI>(2 * one_sui(), ts::ctx(&mut s));
        let clock = clock::create_for_testing(ts::ctx(&mut s));

        jetpack::pay(&mut cap, &mut coin, PAYEE, one_sui() + 1, &clock, ts::ctx(&mut s));

        clock::destroy_for_testing(clock);
        coin::burn_for_testing(coin);
        ts::return_shared(cap);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 0)]
    fun test_expired_cap_aborts() {
        let mut s = setup_shared_cap(one_sui(), 500, vector[]);
        let mut cap = ts::take_shared<SpendingCap>(&s);
        let mut coin = coin::mint_for_testing<SUI>(one_sui(), ts::ctx(&mut s));
        let mut clock = clock::create_for_testing(ts::ctx(&mut s));
        clock::set_for_testing(&mut clock, 1_000);

        jetpack::pay(&mut cap, &mut coin, PAYEE, 100_000_000, &clock, ts::ctx(&mut s));

        clock::destroy_for_testing(clock);
        coin::burn_for_testing(coin);
        ts::return_shared(cap);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 2)]
    fun test_disallowed_payee_aborts() {
        let mut s = setup_shared_cap(one_sui(), 0, vector[PAYEE]);
        let mut cap = ts::take_shared<SpendingCap>(&s);
        let mut coin = coin::mint_for_testing<SUI>(one_sui(), ts::ctx(&mut s));
        let clock = clock::create_for_testing(ts::ctx(&mut s));

        jetpack::pay(&mut cap, &mut coin, RANDO, 100_000_000, &clock, ts::ctx(&mut s));

        clock::destroy_for_testing(clock);
        coin::burn_for_testing(coin);
        ts::return_shared(cap);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 4)]
    fun test_wrong_agent_aborts() {
        let mut s = setup_shared_cap(one_sui(), 0, vector[]);
        let mut cap = ts::take_shared<SpendingCap>(&s);
        let mut coin = coin::mint_for_testing<SUI>(one_sui(), ts::ctx(&mut s));
        let clock = clock::create_for_testing(ts::ctx(&mut s));

        ts::next_tx(&mut s, RANDO);
        jetpack::pay(&mut cap, &mut coin, PAYEE, 100_000_000, &clock, ts::ctx(&mut s));

        clock::destroy_for_testing(clock);
        coin::burn_for_testing(coin);
        ts::return_shared(cap);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 3)]
    fun test_wrong_revoker_aborts() {
        let mut s = setup_shared_cap(one_sui(), 0, vector[]);
        let mut cap = ts::take_shared<SpendingCap>(&s);

        ts::next_tx(&mut s, RANDO);
        jetpack::revoke(&mut cap, ts::ctx(&mut s));

        ts::return_shared(cap);
        ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 5)]
    fun test_pay_on_revoked_cap_aborts() {
        let mut s = setup_shared_cap(one_sui(), 0, vector[]);
        let mut cap = ts::take_shared<SpendingCap>(&s);
        let mut coin = coin::mint_for_testing<SUI>(one_sui(), ts::ctx(&mut s));
        let clock = clock::create_for_testing(ts::ctx(&mut s));

        ts::next_tx(&mut s, OWNER);
        jetpack::revoke(&mut cap, ts::ctx(&mut s));

        ts::next_tx(&mut s, AGENT);
        jetpack::pay(&mut cap, &mut coin, PAYEE, 100_000_000, &clock, ts::ctx(&mut s));

        clock::destroy_for_testing(clock);
        coin::burn_for_testing(coin);
        ts::return_shared(cap);
        ts::end(s);
    }
}
