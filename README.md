# 🛡️ Universal AI Escrow

### AI-Powered Decentralized Escrow Platform on GenLayer

A trustless escrow platform for freelance and service agreements, powered by **GenLayer Intelligent Contracts**. Funds are locked on-chain, and disputes are resolved by an **AI arbitrator running inside the contract** — with the verdict secured by GenLayer's optimistic consensus, not a single off-chain oracle.

<p>
  <img alt="GenVM" src="https://img.shields.io/badge/GenVM-v0.3.0%2B-6E56CF" />
  <img alt="genlayer-js" src="https://img.shields.io/badge/genlayer--js-1.1.x-3B82F6" />
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-5-646CFF" />
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind-3-06B6D4" />
  <img alt="Tests" src="https://img.shields.io/badge/direct--mode%20tests-14%20passing-22C55E" />
</p>

**🚀 Live Demo:** [gen-layer-escrow.vercel.app](https://gen-layer-escrow.vercel.app/)
**📦 Repository:** [Handik4/GenLayer-Escrow](https://github.com/Handik4/GenLayer-Escrow)
**🌐 Network:** GenLayer Testnet (Asimov)

---

## 📖 Overview

Traditional escrow relies on a trusted third party. On EVM chains, automated escrow can lock funds but cannot *reason* about whether work was actually delivered — that still needs a human or a centralized oracle.

**Universal AI Escrow** closes that gap using GenLayer's unique capability: an **Intelligent Contract** that can natively call an LLM and fetch the web *as part of on-chain execution*. When a dispute arises, the contract fetches the worker's proof, asks an LLM whether the contract terms were met, and pays out accordingly — and crucially, the AI decision is **validated by multiple validators through consensus**, so no single node can manipulate the outcome.

```
Employer ──locks budget + penalty──► [ Escrow Contract ]
                                          │
Worker ──accepts──────────────────────────┤
                                          │
Resolution:                               ▼
  • Employer approves        ──► funds released to worker
  • Employer cancels         ──► penalty to worker, budget refunded
  • Worker requests AI ruling ─► contract reads proof + LLM verdict
                                  (consensus-validated) ──► auto payout
```

---

## ✨ Key Features

- **🔒 Smart-Contract Escrow** — Budget and penalty are locked on-chain at deal creation (`msg.value = budget + penalty`). No funds move without a valid state transition.
- **🤖 Consensus-Safe AI Resolution** — Dispute resolution runs `gl.nondet.web.get` + `gl.nondet.exec_prompt` inside a custom leader/validator block (`gl.vm.run_nondet_unsafe`). Validators independently re-derive the verdict and must agree on the funds-moving `win` decision before any payout.
- **⚖️ Deterministic State Machine** — Clear lifecycle: `OPEN → ACTIVE → COMPLETED / CANCELLED`, with strict access control (only the assigned worker can accept, only the employer can approve/cancel).
- **🧮 Precise On-Chain Accounting** — All amounts use `u256` at atto-scale (`value × 10¹⁸`) for safe, cross-chain-compatible math — never floats.
- **⚡ O(log n) Lookups** — Per-address `employer_index` / `worker_index` maps avoid unbounded scans over the full deal set.
- **🛡️ Robust Failure Handling** — Classified error prefixes (`[EXPECTED]`, `[EXTERNAL]`, `[TRANSIENT]`, `[LLM_ERROR]`) let validators correctly agree or disagree on failure paths instead of locking bad state.
- **👛 Native Wallet UX** — React frontend connects through the official **`genlayer-js`** SDK with a polished, responsive interface.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Smart Contract** | GenLayer Intelligent Contract — **GenVM v0.3.0+** (Python) |
| **Blockchain SDK** | **`genlayer-js`** (native GenLayer client — calldata encoding, schema fetch, tx lifecycle) |
| **Frontend** | React 18 |
| **Build Tooling** | Vite 5 |
| **Styling** | Tailwind CSS 3 |
| **Contract Testing** | `genlayer-test` (direct mode) + `pytest` |
| **Contract Linting** | `genvm-linter` |
| **Network** | GenLayer Testnet (Asimov) |

---

## 📜 Smart Contract API

Contract: [`contracts/UniversalEscrow.py`](contracts/UniversalEscrow.py) — 5 write methods, 5 read methods.

### Write (`@gl.public.write`)

| Method | Parameters | Description |
|--------|-----------|-------------|
| `create_deal` *(payable)* | `worker_addr, terms, budget, penalty, duration, tg, phone` | Locks `budget + penalty`; opens a new deal |
| `accept_deal` | `did, tg, phone` | Assigned worker accepts → `ACTIVE` |
| `approve_manually` | `did` | Employer releases `budget + penalty` to worker |
| `cancel_with_penalty` | `did` | Employer cancels: penalty → worker, budget refunded |
| `request_ai_resolution` | `did, proof_url` | Worker submits proof; AI arbitrates and auto-pays on win |

### Read (`@gl.public.view`)

| Method | Parameters | Returns |
|--------|-----------|---------|
| `get_contract_balance` | — | Contract balance (wei) |
| `get_total_deals` | — | Total number of deals |
| `get_deal` | `did` | Full deal record |
| `get_deals_for_worker` | `worker` | Deal IDs where address is worker |
| `get_deals_for_employer` | `employer` | Deal IDs where address is employer |

---

## 📂 Project Structure

```
.
├── contracts/
│   └── UniversalEscrow.py        # GenVM v0.3.0+ Intelligent Contract
├── src/
│   ├── App.jsx                   # React app + genlayer-js integration
│   ├── main.jsx
│   └── index.css
├── tests/
│   └── direct/
│       ├── test_universal_escrow.py   # 14 direct-mode tests
│       └── conftest.py                # test environment setup
├── pytest.ini
├── index.html
├── vite.config.js
└── package.json
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ and npm
- A GenLayer-compatible wallet (e.g. MetaMask) for the live app
- **Python** 3.10+ with `pip` (only needed to run the contract test suite)

### 1. Clone & install

```bash
git clone https://github.com/Handik4/GenLayer-Escrow.git
cd GenLayer-Escrow
npm install
```

### 2. Configure the contract target

Open `src/App.jsx` and confirm the deployment constants near the top:

```js
const CHAIN = testnetAsimov;                                      // GenLayer network
const CONTRACT_ADDRESS = "0xe165C0A38c0aa4cffcf0058F3cb5F602D6039E31";
```

> If you redeploy `contracts/UniversalEscrow.py`, update `CONTRACT_ADDRESS` (and `CHAIN` if you switch networks).

### 3. Run the development server

```bash
npm run dev
```

Then open the local URL printed by Vite (default `http://localhost:5173`).

### 4. Production build

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```

---

## 🧪 Testing & Quality

### Frontend checks

```bash
npm run lint       # ESLint — clean, zero errors
npm run build      # verifies the genlayer-js integration compiles
```

### Smart-contract — lint

```bash
genvm-lint check contracts/UniversalEscrow.py
```

### Smart-contract — direct-mode tests

Direct mode runs the contract in-memory (no node, no Docker) in ~30 ms per test. It exercises every state transition, access-control rule, revert path, and the full AI-resolution flow using mocked web + LLM responses.

```bash
pip install genlayer-test genvm-linter   # one-time
pytest                                    # runs tests/direct/ (configured in pytest.ini)
```

Expected result:

```
tests/direct/test_universal_escrow.py ..............  [100%]
14 passed
```

The suite covers:

- **Lifecycle:** create → accept → approve / cancel
- **AI resolution:** worker wins (→ paid), worker loses (stays active), via mocked `gl.nondet` web + LLM
- **Access control & reverts:** unauthorized worker/employer, double-accept, insufficient funds, missing deal, external `4xx` proof fetch

> **Note:** Direct mode validates the *leader* execution path. Validator-agreement / consensus is covered by integration tests against a live GenLayer environment.

---

## 🔄 Migration to the Latest GenLayer Standards

This project was fully modernized to align with current GenLayer specifications. Highlights of the upgrade:

| Area | Before (legacy) | After (current standard) |
|------|-----------------|--------------------------|
| **Runner header** | invalid `# { "runner": "python" }` (would not load) | pinned `py-genlayer` dependency runner (GenVM v0.3.0+) |
| **Storage types** | `@allow_storage` only, `u64` money | `@allow_storage @dataclass`, `Address`/`u256` atto-scale |
| **AI / web APIs** | `gl.exec_prompt`, `gl.web.get_text`, `gl.transfer` (non-existent) | `gl.nondet.exec_prompt`, `gl.nondet.web.get`, `emit_transfer` |
| **Consensus** | LLM wrapped in `strict_eq` (breaks consensus) | custom `gl.vm.run_nondet_unsafe` leader/validator on the verdict |
| **Error handling** | returned error strings (tx still "succeeds") | `gl.vm.UserError` with classified prefixes → proper reverts |
| **Lookups** | unbounded iteration over the deal map | per-address indexes + bounded loops |
| **Frontend client** | Ethers.js + hand-written EVM ABI | native **`genlayer-js`** (auto schema + calldata) |

The result is a contract that **loads, passes the GenVM linter, passes SDK semantic validation, and clears a full direct-mode test suite**, with a frontend that talks to GenLayer through its first-class SDK.

---

## 🗺️ Roadmap

- [x] Migrate contract to GenVM v0.3.0+ standards
- [x] Migrate frontend from Ethers.js to `genlayer-js`
- [x] Consensus-safe AI dispute resolution
- [x] Direct-mode test suite (14 tests)
- [ ] Integration tests for the validator/consensus path
- [ ] Detailed on-chain transaction history in the UI
- [ ] Enhanced mobile responsiveness
- [ ] Multi-milestone / partial-release escrow

---

## 🙏 Acknowledgments

Built on **[GenLayer](https://genlayer.com)** — the Intelligent Blockchain that lets smart contracts access the web and reason with LLMs under consensus.

*Developed as part of the GenLayer Ecosystem.*
