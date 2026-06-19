"""Direct-mode tests for UniversalEscrow.

Run with:
    pytest tests/direct -v -p no:gltest

(The `-p no:gltest` disables the network-CLI plugin, which is incompatible with
Python 3.14; the in-memory `gltest_direct` plugin used here works fine.)

Direct mode runs the leader function only — validator agreement is covered by
integration tests, not here.
"""

import json

CONTRACT = "contracts/UniversalEscrow.py"

# Status codes returned by get_deal (mirror of _STATUS_TO_CODE in the contract).
OPEN, ACTIVE, COMPLETED, CANCELLED = 0, 1, 2, 3

BUDGET = 1_000_000_000_000_000_000   # 1 token (atto-scale)
PENALTY = 100_000_000_000_000_000    # 0.1 token
REQUIRED = BUDGET + PENALTY


def _hex(addr):
    """Canonical 0x-hex string for a test address fixture.

    The direct runner may hand back an Address, raw 20-byte bytes, or a string
    depending on SDK-path state, so normalise all three.
    """
    h = getattr(addr, "as_hex", None)
    if h:
        return h
    if isinstance(addr, (bytes, bytearray)):
        return "0x" + bytes(addr).hex()
    return str(addr)


def _create(contract, direct_vm, employer, worker, value=REQUIRED, terms="Build a landing page"):
    direct_vm.sender = employer
    direct_vm.value = value
    return contract.create_deal(_hex(worker), terms, BUDGET, PENALTY, 604800, "@emp", "+100")


# ─────────────────────────── create_deal ────────────────────────────

def test_create_deal_locks_and_indexes(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    _create(contract, direct_vm, direct_alice, direct_bob)

    assert contract.get_total_deals() == 1

    deal = contract.get_deal(0)
    assert deal["status"] == OPEN
    assert deal["budget"] == BUDGET
    assert deal["penalty"] == PENALTY
    assert _hex(direct_alice).lower() == str(deal["employer"]).lower()
    assert _hex(direct_bob).lower() == str(deal["worker"]).lower()

    # Address-indexed lookups (no full-map scan) return the new deal id.
    assert 0 in list(contract.get_deals_for_employer(_hex(direct_alice)))
    assert 0 in list(contract.get_deals_for_worker(_hex(direct_bob)))


def test_create_deal_insufficient_funds_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    direct_vm.value = REQUIRED - 1  # one atto short
    with direct_vm.expect_revert("INSUFFICIENT_FUNDS_SENT"):
        contract.create_deal(_hex(direct_bob), "terms", BUDGET, PENALTY, 604800, "@emp", "+100")


def test_get_deal_not_found_reverts(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    with direct_vm.expect_revert("DEAL_NOT_FOUND"):
        contract.get_deal(999)


# ─────────────────────────── accept_deal ────────────────────────────

def test_accept_deal_activates(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    _create(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.sender = direct_bob
    direct_vm.value = 0
    contract.accept_deal(0, "@bob", "+200")

    deal = contract.get_deal(0)
    assert deal["status"] == ACTIVE


def test_accept_deal_wrong_worker_reverts(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    _create(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.sender = direct_charlie  # not the assigned worker
    direct_vm.value = 0
    with direct_vm.expect_revert("UNAUTHORIZED_WORKER"):
        contract.accept_deal(0, "@chuck", "+300")


def test_accept_deal_twice_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    _create(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    contract.accept_deal(0, "@bob", "+200")
    with direct_vm.expect_revert("DEAL_NOT_AVAILABLE"):
        contract.accept_deal(0, "@bob", "+200")


# ───────────────────────── approve_manually ─────────────────────────

def test_approve_manually_completes(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    _create(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.sender = direct_bob; direct_vm.value = 0
    contract.accept_deal(0, "@bob", "+200")

    direct_vm.sender = direct_alice; direct_vm.value = 0
    contract.approve_manually(0)

    assert contract.get_deal(0)["status"] == COMPLETED


def test_approve_only_employer_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    _create(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.sender = direct_bob; direct_vm.value = 0
    contract.accept_deal(0, "@bob", "+200")
    # Worker tries to approve their own payout.
    with direct_vm.expect_revert("ONLY_EMPLOYER"):
        contract.approve_manually(0)


def test_approve_requires_active_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    _create(contract, direct_vm, direct_alice, direct_bob)  # still OPEN, never accepted
    direct_vm.sender = direct_alice; direct_vm.value = 0
    with direct_vm.expect_revert("DEAL_NOT_ACTIVE"):
        contract.approve_manually(0)


# ──────────────────────── cancel_with_penalty ───────────────────────

def test_cancel_with_penalty(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    _create(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.sender = direct_bob; direct_vm.value = 0
    contract.accept_deal(0, "@bob", "+200")

    direct_vm.sender = direct_alice; direct_vm.value = 0
    contract.cancel_with_penalty(0)

    assert contract.get_deal(0)["status"] == CANCELLED


# ─────────────────────── request_ai_resolution ──────────────────────

def _arm_active_deal(contract, direct_vm, direct_alice, direct_bob):
    _create(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.sender = direct_bob; direct_vm.value = 0
    contract.accept_deal(0, "@bob", "+200")


def test_ai_resolution_worker_wins(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    _arm_active_deal(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.mock_web(r".*proof.*", {"status": 200, "body": "Deliverable shipped and live."})
    direct_vm.mock_llm(r".*impartial arbitrator.*", json.dumps({"win": True}))

    direct_vm.sender = direct_bob; direct_vm.value = 0
    res = contract.request_ai_resolution(0, "https://proof.example.com/evidence")

    assert "WORKER_WON" in res
    assert contract.get_deal(0)["status"] == COMPLETED


def test_ai_resolution_worker_loses(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    _arm_active_deal(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.mock_web(r".*proof.*", {"status": 200, "body": "Nothing delivered."})
    direct_vm.mock_llm(r".*impartial arbitrator.*", json.dumps({"win": False}))

    direct_vm.sender = direct_bob; direct_vm.value = 0
    res = contract.request_ai_resolution(0, "https://proof.example.com/evidence")

    assert "WORKER_LOST" in res
    # Deal stays ACTIVE so the worker can try again / employer can act.
    assert contract.get_deal(0)["status"] == ACTIVE


def test_ai_resolution_only_worker_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    _arm_active_deal(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.sender = direct_alice  # employer cannot trigger AI resolution
    direct_vm.value = 0
    with direct_vm.expect_revert("ONLY_WORKER"):
        contract.request_ai_resolution(0, "https://proof.example.com/evidence")


def test_ai_resolution_external_4xx_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    _arm_active_deal(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.mock_web(r".*proof.*", {"status": 404, "body": "not found"})

    direct_vm.sender = direct_bob; direct_vm.value = 0
    with direct_vm.expect_revert("PROOF_FETCH_4XX"):
        contract.request_ai_resolution(0, "https://proof.example.com/evidence")
