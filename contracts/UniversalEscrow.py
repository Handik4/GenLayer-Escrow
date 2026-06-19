# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
from dataclasses import dataclass
import json

# ─────────────────────────────────────────────────────────────────────────────
# Error classification — lets validators agree (or correctly disagree) on the
# failure path during consensus. Prefixes are matched in _handle_leader_error.
# ─────────────────────────────────────────────────────────────────────────────
ERROR_EXPECTED = "[EXPECTED]"     # Deterministic business-logic error — must match exactly
ERROR_EXTERNAL = "[EXTERNAL]"     # External 4xx — deterministic — must match exactly
ERROR_TRANSIENT = "[TRANSIENT]"   # Network / 5xx — agree if both transient
ERROR_LLM = "[LLM_ERROR]"         # LLM misbehavior — disagree to force validator rotation

# Status codes mirrored by the React frontend (STATUS map in App.jsx).
STATUS_OPEN = "OPEN"
STATUS_ACTIVE = "ACTIVE"
STATUS_COMPLETED = "COMPLETED"
STATUS_CANCELLED = "CANCELLED_BY_EMPLOYER"

_STATUS_TO_CODE = {
    STATUS_OPEN: 0,
    STATUS_ACTIVE: 1,
    STATUS_COMPLETED: 2,
    STATUS_CANCELLED: 3,
}


def _coerce_bool(val: object) -> bool:
    """Defensively coerce an LLM 'win' value (bool / int / str) into a bool."""
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val != 0
    if isinstance(val, str):
        return val.strip().lower() in ("true", "1", "yes", "win", "won", "fulfilled")
    return False


def _handle_leader_error(leaders_res: gl.vm.Result, leader_fn) -> bool:
    """Validator-side comparison when the leader returned an error instead of a value."""
    leader_msg = getattr(leaders_res, "message", "") or ""
    try:
        leader_fn()
        # Leader errored but validator succeeded → genuine disagreement.
        return False
    except gl.vm.UserError as e:
        validator_msg = getattr(e, "message", None) or str(e)
        # Deterministic errors must match byte-for-byte.
        if validator_msg.startswith(ERROR_EXPECTED) or validator_msg.startswith(ERROR_EXTERNAL):
            return validator_msg == leader_msg
        # Transient failures: agree only if both sides hit a transient error.
        if validator_msg.startswith(ERROR_TRANSIENT) and leader_msg.startswith(ERROR_TRANSIENT):
            return True
        # LLM / unknown: disagree to force consensus retry on fresh validators.
        return False
    except Exception:
        return False


@allow_storage
@dataclass
class Agreement:
    employer: Address
    worker: Address
    terms: str
    budget: u256          # atto-scale (wei, value * 10**18) — never float
    penalty: u256         # atto-scale (wei)
    duration: u64         # seconds (relative window agreed off-chain)
    created_at: u64       # reserved: GenVM exposes no deterministic wall-clock
    employer_tg: str
    employer_phone: str
    worker_tg: str
    worker_phone: str
    status: str           # STATUS_* string constant


class UniversalEscrow(gl.Contract):
    # ── Persistent storage: class-level annotations only ──────────────────────
    deals: TreeMap[str, Agreement]            # deal_id (str) -> Agreement
    employer_index: TreeMap[str, DynArray[u64]]  # employer hex -> [deal_id]
    worker_index: TreeMap[str, DynArray[u64]]    # worker hex   -> [deal_id]
    total_deals: u64

    def __init__(self) -> None:
        # Only primitives are initialized here. TreeMap/DynArray start empty.
        self.total_deals = u64(0)

    # ── Internal helpers (not exposed; no decorator) ──────────────────────────
    def _pay(self, to: Address, amount: u256) -> None:
        """Queue a native-token transfer. emit_transfer rejects zero, so guard it."""
        if amount > u256(0):
            # 'finalized' is the safe choice for value transfers (avoids paying out
            # on a state that may still be appealed/reverted).
            gl.get_contract_at(to).emit_transfer(value=amount, on="finalized")

    def _require_deal(self, did: u64) -> tuple[str, Agreement]:
        key = str(did)
        if key not in self.deals:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} DEAL_NOT_FOUND")
        return key, self.deals[key]

    # ── WRITE METHODS ─────────────────────────────────────────────────────────
    @gl.public.write.payable
    def create_deal(
        self,
        worker_addr: str,
        terms: str,
        budget: u256,
        penalty: u256,
        duration: u64,
        tg: str,
        phone: str,
    ) -> str:
        required_funds = budget + penalty
        if gl.message.value < required_funds:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} INSUFFICIENT_FUNDS_SENT required={required_funds}"
            )

        employer = gl.message.sender_address
        worker = Address(worker_addr)
        deal_id = self.total_deals
        key = str(deal_id)

        self.deals[key] = Agreement(
            employer=employer,
            worker=worker,
            terms=terms,
            budget=budget,
            penalty=penalty,
            duration=duration,
            created_at=u64(0),
            employer_tg=tg,
            employer_phone=phone,
            worker_tg="",
            worker_phone="",
            status=STATUS_OPEN,
        )

        # Maintain O(1)-append indexes so lookups never scan the whole map.
        self.employer_index.get_or_insert_default(employer.as_hex).append(deal_id)
        self.worker_index.get_or_insert_default(worker.as_hex).append(deal_id)

        self.total_deals += u64(1)
        return f"SUCCESS: DEAL_{key}_CREATED_AND_LOCKED"

    @gl.public.write
    def accept_deal(self, did: u64, tg: str, phone: str) -> str:
        key, deal = self._require_deal(did)
        if gl.message.sender_address != deal.worker:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} UNAUTHORIZED_WORKER")
        if deal.status != STATUS_OPEN:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} DEAL_NOT_AVAILABLE")

        deal.worker_tg = tg
        deal.worker_phone = phone
        deal.status = STATUS_ACTIVE
        self.deals[key] = deal
        return "SUCCESS: DEAL_ACTIVATED"

    @gl.public.write
    def approve_manually(self, did: u64) -> str:
        key, deal = self._require_deal(did)
        if gl.message.sender_address != deal.employer:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} ONLY_EMPLOYER")
        if deal.status != STATUS_ACTIVE:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} DEAL_NOT_ACTIVE")

        payout = deal.budget + deal.penalty
        deal.status = STATUS_COMPLETED
        self.deals[key] = deal
        self._pay(deal.worker, payout)
        return "SUCCESS: FUNDS_TRANSFERRED_TO_WORKER"

    @gl.public.write
    def cancel_with_penalty(self, did: u64) -> str:
        key, deal = self._require_deal(did)
        if gl.message.sender_address != deal.employer:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} ONLY_EMPLOYER")
        if deal.status != STATUS_ACTIVE:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} INVALID_STATUS")

        deal.status = STATUS_CANCELLED
        self.deals[key] = deal
        self._pay(deal.worker, deal.penalty)    # penalty compensates the worker
        self._pay(deal.employer, deal.budget)   # remaining budget refunded
        return "SUCCESS: PENALTY_PAID_TO_WORKER_REMAINDER_REFUNDED"

    @gl.public.write
    def request_ai_resolution(self, did: u64, proof_url: str) -> str:
        key, deal = self._require_deal(did)
        if gl.message.sender_address != deal.worker:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} ONLY_WORKER")
        if deal.status != STATUS_ACTIVE:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} NOT_ACTIVE")

        terms_snapshot = deal.terms

        def leader_fn() -> str:
            res = gl.nondet.web.get(proof_url)
            if res.status >= 500:
                raise gl.vm.UserError(f"{ERROR_TRANSIENT} PROOF_FETCH_5XX {res.status}")
            if res.status >= 400:
                raise gl.vm.UserError(f"{ERROR_EXTERNAL} PROOF_FETCH_4XX {res.status}")

            evidence = res.body.decode("utf-8", errors="replace")[:2000]
            analysis = gl.nondet.exec_prompt(
                "You are an impartial arbitrator resolving a freelance escrow dispute.\n"
                f"CONTRACT TERMS:\n{terms_snapshot}\n\n"
                f"WORKER-SUBMITTED PROOF:\n{evidence}\n\n"
                'Decide strictly whether the worker fulfilled the contract terms. '
                'Respond with JSON only: {"win": true} if fulfilled, otherwise {"win": false}.',
                response_format="json",
            )
            if not isinstance(analysis, dict):
                raise gl.vm.UserError(f"{ERROR_LLM} NON_DICT_RESPONSE {type(analysis)}")
            if "win" not in analysis:
                raise gl.vm.UserError(
                    f"{ERROR_LLM} MISSING_WIN keys={list(analysis.keys())}"
                )
            return json.dumps({"win": _coerce_bool(analysis["win"])}, sort_keys=True)

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return _handle_leader_error(leaders_res, leader_fn)
            mine = json.loads(leader_fn())
            theirs = json.loads(leaders_res.calldata)
            # Consensus requires an identical verdict — the funds-moving bit.
            return mine["win"] == theirs["win"]

        verdict_str = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        try:
            verdict = json.loads(verdict_str)
        except Exception:
            raise gl.vm.UserError(f"{ERROR_LLM} UNPARSEABLE_VERDICT")

        if verdict.get("win", False):
            payout = deal.budget + deal.penalty
            deal.status = STATUS_COMPLETED
            self.deals[key] = deal
            self._pay(deal.worker, payout)
            return "AI_RESULT: WORKER_WON_AND_PAID"
        return "AI_RESULT: WORKER_LOST_WORK_STILL_ACTIVE"

    # ── VIEW METHODS ──────────────────────────────────────────────────────────
    @gl.public.view
    def get_contract_balance(self) -> u256:
        return gl.get_contract_at(gl.message.contract_address).balance

    @gl.public.view
    def get_total_deals(self) -> u64:
        return self.total_deals

    @gl.public.view
    def get_deal(self, did: u64) -> dict:
        key = str(did)
        if key not in self.deals:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} DEAL_NOT_FOUND")
        deal = self.deals[key]
        return {
            "employer": deal.employer.as_hex,
            "worker": deal.worker.as_hex,
            "terms": deal.terms,
            "budget": deal.budget,
            "penalty": deal.penalty,
            "duration": deal.duration,
            "status": _STATUS_TO_CODE.get(deal.status, 0),
            "created_at": deal.created_at,
        }

    @gl.public.view
    def get_deals_for_worker(self, worker: str) -> DynArray[u64]:
        return self._ids_for(self.worker_index, Address(worker).as_hex)

    @gl.public.view
    def get_deals_for_employer(self, employer: str) -> DynArray[u64]:
        return self._ids_for(self.employer_index, Address(employer).as_hex)

    def _ids_for(self, index: TreeMap[str, DynArray[u64]], hex_key: str) -> list:
        out: list = []
        if hex_key not in index:
            return out
        ids = index[hex_key]
        # Bounded loop over this address's own deals only — never the whole map.
        for i in range(len(ids)):
            out.append(ids[i])
        return out
