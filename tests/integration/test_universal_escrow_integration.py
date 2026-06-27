"""Integration tests for UniversalEscrow — full consensus (leader + validators).

Unlike the direct-mode suite (tests/direct), these run against a real GenLayer
node and exercise the actual GenVM, consensus, payable value transfers, and
state persistence across transactions.

Start a local node first, then run:

    glsim --port 4000 --validators 5 --no-browser
    gltest tests/integration -v -s

Or against hosted Studio (gasless, no funding):

    gltest tests/integration -v -s --network studionet

The LLM dispute path (request_ai_resolution) is covered in direct mode with
mock_llm/mock_web and is intentionally excluded here, since it requires a node
configured with a real LLM provider. It can be added behind @pytest.mark.slow
once an LLM-enabled network is available.
"""

import pytest
from gltest import get_contract_factory, get_accounts
from gltest.assertions import tx_execution_succeeded, tx_execution_failed

# Status codes returned by get_deal (mirror of _STATUS_TO_CODE in the contract).
OPEN, ACTIVE, COMPLETED, CANCELLED = 0, 1, 2, 3

BUDGET = 1_000_000_000_000_000_000   # 1 token (atto-scale)
PENALTY = 100_000_000_000_000_000    # 0.1 token
REQUIRED = BUDGET + PENALTY

TERMS = "Build a landing page"
DURATION = 604_800  # 7 days, seconds


@pytest.fixture(scope="module")
def accounts():
    """Employer (default/deployer) and worker accounts from the network."""
    accts = get_accounts()
    assert len(accts) >= 2, "localnet should expose at least two funded accounts"
    return accts[0], accts[1]


def _deploy(employer):
    factory = get_contract_factory("UniversalEscrow")
    return factory.deploy(args=[], account=employer)


def _create_deal(contract, worker, value=REQUIRED):
    return contract.create_deal(
        args=[worker.address, TERMS, BUDGET, PENALTY, DURATION, "@emp", "+100"],
    ).transact(value=value)


# ───────────────────────────── happy path ──────────────────────────────

def test_full_lifecycle_create_accept_approve(accounts):
    employer, worker = accounts
    contract = _deploy(employer)

    # create_deal locks budget + penalty in the contract.
    receipt = _create_deal(contract, worker)
    assert tx_execution_succeeded(receipt)

    assert contract.get_total_deals().call() == 1
    assert contract.get_contract_balance().call() == REQUIRED

    deal = contract.get_deal(args=[0]).call()
    assert deal["status"] == OPEN
    assert deal["budget"] == BUDGET
    assert deal["penalty"] == PENALTY
    assert deal["employer"].lower() == employer.address.lower()
    assert deal["worker"].lower() == worker.address.lower()

    # Address-indexed lookups return the new deal id.
    assert 0 in list(contract.get_deals_for_employer(args=[employer.address]).call())
    assert 0 in list(contract.get_deals_for_worker(args=[worker.address]).call())

    # Worker accepts → ACTIVE.
    receipt = contract.connect(worker).accept_deal(args=[0, "@bob", "+200"]).transact()
    assert tx_execution_succeeded(receipt)
    assert contract.get_deal(args=[0]).call()["status"] == ACTIVE

    # Employer approves → COMPLETED, funds released to worker.
    receipt = contract.connect(employer).approve_manually(args=[0]).transact()
    assert tx_execution_succeeded(receipt)
    assert contract.get_deal(args=[0]).call()["status"] == COMPLETED


def test_cancel_with_penalty_flow(accounts):
    employer, worker = accounts
    contract = _deploy(employer)

    assert tx_execution_succeeded(_create_deal(contract, worker))
    assert tx_execution_succeeded(
        contract.connect(worker).accept_deal(args=[0, "@bob", "+200"]).transact()
    )

    receipt = contract.connect(employer).cancel_with_penalty(args=[0]).transact()
    assert tx_execution_succeeded(receipt)
    assert contract.get_deal(args=[0]).call()["status"] == CANCELLED


# ───────────────────────────── revert paths ────────────────────────────

def test_create_deal_insufficient_funds_reverts(accounts):
    employer, worker = accounts
    contract = _deploy(employer)

    receipt = _create_deal(contract, worker, value=REQUIRED - 1)  # one atto short
    assert tx_execution_failed(receipt)
    assert contract.get_total_deals().call() == 0


def test_accept_deal_wrong_worker_reverts(accounts):
    employer, worker = accounts
    contract = _deploy(employer)
    assert tx_execution_succeeded(_create_deal(contract, worker))

    # Employer (not the assigned worker) tries to accept.
    receipt = contract.connect(employer).accept_deal(args=[0, "@x", "+1"]).transact()
    assert tx_execution_failed(receipt)
    assert contract.get_deal(args=[0]).call()["status"] == OPEN


def test_approve_only_employer_reverts(accounts):
    employer, worker = accounts
    contract = _deploy(employer)
    assert tx_execution_succeeded(_create_deal(contract, worker))
    assert tx_execution_succeeded(
        contract.connect(worker).accept_deal(args=[0, "@bob", "+200"]).transact()
    )

    # Worker tries to approve their own payout.
    receipt = contract.connect(worker).approve_manually(args=[0]).transact()
    assert tx_execution_failed(receipt)
    assert contract.get_deal(args=[0]).call()["status"] == ACTIVE
