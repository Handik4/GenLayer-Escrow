# v0.1.0
# { "Depends": "py-genlayer:latest" }

from genlayer import *
import json
from dataclasses import dataclass

@allow_storage
@dataclass
class Agreement:
    employer: str
    worker: str
    terms: str
    budget: u64
    penalty: u64
    deadline: u64
    employer_tg: str
    employer_phone: str
    worker_tg: str
    worker_phone: str
    status: str # OPEN, ACTIVE, COMPLETED, CANCELLED_BY_EMPLOYER

class UniversalEscrow(gl.Contract):
    deals: TreeMap[u64, Agreement]
    total_deals: u64

    def __init__(self):
        self.deals = TreeMap()
        self.total_deals = u64(0)

    @gl.public.write
    def create_deal(self, worker_addr: str, terms: str, budget: u64, penalty: u64, duration: u64, tg: str, phone: str):
        # Check if employer sent enough funds
        required_funds = budget + penalty
        if gl.message.value < required_funds:
            return f"ERROR: INSUFFICIENT_FUNDS. REQUIRED: {required_funds}"

        did = self.total_deals
        self.deals[did] = Agreement(
            employer=gl.message.sender_address,
            worker=worker_addr,
            terms=terms,
            budget=budget,
            penalty=penalty,
            deadline=duration,
            employer_tg=tg,
            employer_phone=phone,
            worker_tg="",
            worker_phone="",
            status="OPEN"
        )
        self.total_deals += u64(1)
        return f"SUCCESS: DEAL_{did}_CREATED"

    @gl.public.write
    def accept_deal(self, did: u64, tg: str, phone: str):
        if did not in self.deals: return "ERROR: NOT_FOUND"
        deal = self.deals[did]
        
        if gl.message.sender_address != deal.worker: return "ERROR: UNAUTHORIZED"
        if deal.status != "OPEN": return "ERROR: UNAVAILABLE"
        
        deal.worker_tg = tg
        deal.worker_phone = phone
        deal.status = "ACTIVE"
        self.deals[did] = deal
        return "SUCCESS: DEAL_ACTIVATED"

    @gl.public.write
    def approve_and_pay(self, did: u64):
        deal = self.deals[did]
        if gl.message.sender_address != deal.employer: return "ERROR: ONLY_EMPLOYER"
        if deal.status != "ACTIVE": return "ERROR: NOT_ACTIVE"
        
        total_payout = deal.budget + deal.penalty
        deal.status = "COMPLETED"
        self.deals[did] = deal
        
        # Correct transfer method based on official boilerplate
        gl.chain.Account(deal.worker).emit_transfer(total_payout)
        return "SUCCESS: PAID_TO_WORKER"

    @gl.public.write
    def cancel_with_penalty(self, did: u64):
        deal = self.deals[did]
        if gl.message.sender_address != deal.employer: return "ERROR: ONLY_EMPLOYER"
        if deal.status != "ACTIVE": return "ERROR: INVALID_STATUS"
        
        deal.status = "CANCELLED_BY_EMPLOYER"
        self.deals[did] = deal
        
        gl.chain.Account(deal.worker).emit_transfer(deal.penalty)
        gl.chain.Account(deal.employer).emit_transfer(deal.budget)
        return "SUCCESS: PENALTY_PROCESSED"

    @gl.public.write
    def request_ai_resolution(self, did: u64, proof_url: str):
        deal = self.deals[did]
        if gl.message.sender_address != deal.worker: return "ERROR: ONLY_WORKER"
        if deal.status != "ACTIVE": return "ERROR: NOT_ACTIVE"

        # Correct Web access and AI consensus logic from the boilerplate
        web_content = gl.nondet.web.get(proof_url)
        
        prompt = f"Contract terms: {deal.terms}. Proof from URL: {web_content[:1000]}. Does the proof satisfy the terms? Reply only with a JSON object: {{\"win\": true}} or {{\"win\": false}}"
        
        # Using prompt_non_comparative as seen in official examples
        ai_response = gl.eq_principle.prompt_non_comparative(
            gl.nondet.exec_prompt(prompt, num_proposers=3)
        )

        try:
            res = json.loads(ai_response)
            if res.get("win", False):
                total_payout = deal.budget + deal.penalty
                deal.status = "COMPLETED"
                self.deals[did] = deal
                gl.chain.Account(deal.worker).emit_transfer(total_payout)
                return "AI_RESULT: WORKER_WON"
            else:
                return "AI_RESULT: WORKER_LOST"
        except:
            return "ERROR: AI_PARSING_FAILED"

    @gl.public.view
    def get_contract_balance(self) -> u64:
        # Correct way to get balance from the boilerplate
        return self.balance
