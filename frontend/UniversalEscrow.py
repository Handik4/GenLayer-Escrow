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
        """
        Step 1: Employer creates deal. 
        Note: Employer must send (budget + penalty) as msg_value to lock funds.
        """
        required_funds = budget + penalty
        if gl.message.value < required_funds:
            return f"ERROR: INSUFFICIENT_FUNDS_SENT. REQUIRED: {required_funds}"

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
        return f"SUCCESS: DEAL_{did}_CREATED_AND_LOCKED"

    @gl.public.write
    def accept_deal(self, did: u64, tg: str, phone: str):
        if did not in self.deals: return "ERROR: NOT_FOUND"
        deal = self.deals[did]
        
        if gl.message.sender_address != deal.worker: return "ERROR: UNAUTHORIZED_WORKER"
        if deal.status != "OPEN": return "ERROR: DEAL_NOT_AVAILABLE"
        
        deal.worker_tg = tg
        deal.worker_phone = phone
        deal.status = "ACTIVE"
        self.deals[did] = deal
        return "SUCCESS: DEAL_ACTIVATED"

    @gl.public.write
    def approve_and_pay(self, did: u64):
        """Employer approves: Worker gets Budget + Penalty back"""
        deal = self.deals[did]
        if gl.message.sender_address != deal.employer: return "ERROR: ONLY_EMPLOYER"
        if deal.status != "ACTIVE": return "ERROR: DEAL_NOT_ACTIVE"
        
        total_payout = deal.budget + deal.penalty
        deal.status = "COMPLETED"
        self.deals[did] = deal
        
        # Transfer funds to Worker
        gl.transfer(deal.worker, total_payout)
        return "SUCCESS: FUNDS_TRANSFERRED_TO_WORKER"

    @gl.public.write
    def cancel_with_penalty_payout(self, did: u64):
        """Employer cancels: Worker gets Penalty, Employer gets Budget back"""
        deal = self.deals[did]
        if gl.message.sender_address != deal.employer: return "ERROR: ONLY_EMPLOYER"
        if deal.status != "ACTIVE": return "ERROR: INVALID_STATUS"
        
        deal.status = "CANCELLED_BY_EMPLOYER"
        self.deals[did] = deal
        
        # Split funds
        gl.transfer(deal.worker, deal.penalty)   # Penalty to Worker
        gl.transfer(deal.employer, deal.budget) # Refund Budget to Employer
        return "SUCCESS: PENALTY_PAID_TO_WORKER_REMAINDER_REFUNDED"

    @gl.public.write
    def request_ai_resolution(self, did: u64, proof_url: str):
        deal = self.deals[did]
        if gl.message.sender_address != deal.worker: return "ERROR: ONLY_WORKER"
        if deal.status != "ACTIVE": return "ERROR: NOT_ACTIVE"

        def ai_arbitration():
            data = gl.web.get_text(proof_url)
            prompt = f"Contract: {deal.terms}. Proof: {data[:1000]}. Decision JSON: {{'win': true/false}}"
            return gl.ai.generate_text(prompt)

        raw_result = gl.nondet(ai_arbitration)
        try:
            clean_res = raw_result.strip().replace("```json", "").replace("```", "")
            res = json.loads(clean_res)
            
            if res.get("win", False):
                total_payout = deal.budget + deal.penalty
                deal.status = "COMPLETED"
                self.deals[did] = deal
                gl.transfer(deal.worker, total_payout)
                return "AI_RESULT: WORKER_WON_AND_PAID"
            else:
                return "AI_RESULT: WORKER_LOST_WORK_STILL_ACTIVE"
        except:
            return "ERROR: AI_CONSENSUS_FAILED"

    @gl.public.view
    def get_contract_balance(self) -> u64:
        """Shows total funds currently locked in this smart contract"""
        return gl.get_balance(gl.address)