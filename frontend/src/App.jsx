import { useState, useEffect, useCallback, useRef } from "react";
import {
  Shield, Clock, DollarSign, Brain, Wallet, CheckCircle, XCircle,
  AlertCircle, Loader2, Activity, Plus, Eye, RefreshCw, Copy,
  ExternalLink, Zap, Hash, ChevronDown, Info
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════
//  CONTRACT CONFIG — Paste your ABI + address here
// ═══════════════════════════════════════════════════════════════════
const CONTRACT_CONFIG = {
  address: "0xEcbf9DabB48f2244b1AD0637bf6A63dAEd988458",
  // GenLayer Python contract ABI aligned to exact function signatures
  abi: [
    {
      name: "create_deal",
      type: "function",
      stateMutability: "payable",
      inputs: [
        { name: "worker_addr", type: "address" },
        { name: "terms",       type: "string"  },
        { name: "budget",      type: "uint64"  },
        { name: "penalty",     type: "uint64"  },
        { name: "duration",    type: "uint64"  },
        { name: "tg",          type: "string"  },
        { name: "phone",       type: "string"  }
      ],
      outputs: []
    },
    {
      name: "accept_deal",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        { name: "did",   type: "uint64" },
        { name: "tg",    type: "string" },
        { name: "phone", type: "string" }
      ],
      outputs: []
    },
    {
      name: "approve_manually",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [{ name: "did", type: "uint64" }],
      outputs: []
    },
    {
      name: "cancel_with_penalty",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [{ name: "did", type: "uint64" }],
      outputs: []
    },
    {
      name: "request_ai_resolution",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        { name: "did",       type: "uint64" },
        { name: "proof_url", type: "string" }
      ],
      outputs: []
    },
    {
      name: "get_contract_balance",
      type: "function",
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "uint256" }]
    },
    {
      name: "get_deal",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "did", type: "uint64" }],
      outputs: [
        { name: "employer",  type: "address" },
        { name: "worker",    type: "address" },
        { name: "terms",     type: "string"  },
        { name: "budget",    type: "uint64"  },
        { name: "penalty",   type: "uint64"  },
        { name: "duration",  type: "uint64"  },
        { name: "status",    type: "uint8"   },
        { name: "created_at","type": "uint64" }
      ]
    },
    {
      name: "get_deals_for_worker",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "worker", type: "address" }],
      outputs: [{ name: "", type: "uint64[]" }]
    },
    {
      name: "get_deals_for_employer",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "employer", type: "address" }],
      outputs: [{ name: "", type: "uint64[]" }]
    }
  ]
};

// ═══════════════════════════════════════════════════════════════════
//  CONTRACT SERVICE  (Ethers v6 — BrowserProvider)
// ═══════════════════════════════════════════════════════════════════
const ETHERS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.min.js";

let _ethers = null;
async function getEthers() {
  if (_ethers) return _ethers;
  // Dynamically import ethers v6 once
  const mod = await import(ETHERS_CDN);
  _ethers = mod.ethers ?? mod;
  return _ethers;
}

async function getProvider() {
  if (!window.ethereum) throw new Error("No wallet detected. Please install MetaMask.");
  const { ethers } = await getEthers();
  return new ethers.BrowserProvider(window.ethereum);
}

async function getContract(withSigner = false) {
  const { ethers } = await getEthers();
  const provider = await getProvider();
  if (withSigner) {
    const signer = await provider.getSigner();
    return new ethers.Contract(CONTRACT_CONFIG.address, CONTRACT_CONFIG.abi, signer);
  }
  return new ethers.Contract(CONTRACT_CONFIG.address, CONTRACT_CONFIG.abi, provider);
}

/** Convert ETH string → Wei BigInt */
async function toWei(ethStr) {
  const { ethers } = await getEthers();
  return ethers.parseEther(String(ethStr));
}

/** Convert Wei BigInt → ETH string (4 dp) */
async function fromWei(wei) {
  const { ethers } = await getEthers();
  return parseFloat(ethers.formatEther(BigInt(wei))).toFixed(4);
}

const ContractService = {
  /**
   * create_deal — msg_value MUST equal budget + penalty (in Wei)
   * budgetWei and penaltyWei are already BigInt (Wei)
   */
  async createDeal({ workerAddr, terms, budgetWei, penaltyWei, duration, tg, phone }) {
    const contract = await getContract(true);
    const msgValue = budgetWei + penaltyWei;
    const tx = await contract.create_deal(
      workerAddr,
      terms,
      budgetWei,       // uint64 — the contract receives raw wei value
      penaltyWei,      // uint64
      BigInt(duration),
      tg,
      phone,
      { value: msgValue }
    );
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  },

  /** accept_deal(did: u64, tg: str, phone: str) */
  async acceptDeal({ did, tg, phone }) {
    const contract = await getContract(true);
    const tx = await contract.accept_deal(BigInt(did), tg, phone);
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  },

  /** approve_manually(did: u64) — releases funds to worker */
  async approveManually({ did }) {
    const contract = await getContract(true);
    const tx = await contract.approve_manually(BigInt(did));
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  },

  /** cancel_with_penalty(did: u64) — splits funds between employer and worker */
  async cancelWithPenalty({ did }) {
    const contract = await getContract(true);
    const tx = await contract.cancel_with_penalty(BigInt(did));
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  },

  /** request_ai_resolution(did: u64, proof_url: str) */
  async requestAIResolution({ did, proofUrl }) {
    const contract = await getContract(true);
    const tx = await contract.request_ai_resolution(BigInt(did), proofUrl);
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  },

  async getContractBalance() {
    try {
      const contract = await getContract(false);
      const raw = await contract.get_contract_balance();
      return fromWei(raw);
    } catch { return "—"; }
  },

  async getDeal(did) {
    const contract = await getContract(false);
    return await contract.get_deal(BigInt(did));
  },

  async getDealsForWorker(address) {
    const contract = await getContract(false);
    return await contract.get_deals_for_worker(address);
  },

  async getDealsForEmployer(address) {
    const contract = await getContract(false);
    return await contract.get_deals_for_employer(address);
  }
};

// ═══════════════════════════════════════════════════════════════════
//  STATUS CONFIG — aligned to GenLayer Python contract states
// ═══════════════════════════════════════════════════════════════════
const STATUS = {
  0: { label: "OPEN",                  color: "text-blue-400   bg-blue-400/10   border-blue-400/30"   },
  1: { label: "ACTIVE",               color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30"},
  2: { label: "COMPLETED",            color: "text-cyan-400   bg-cyan-400/10   border-cyan-400/30"   },
  3: { label: "CANCELLED_BY_EMPLOYER",color: "text-red-400    bg-red-400/10    border-red-400/30"    },
};

// ═══════════════════════════════════════════════════════════════════
//  MOCK DATA (demo mode)
// ═══════════════════════════════════════════════════════════════════
const MOCK_WALLET = "0xDEMO0000000000000000000000000000DEMO0001";
const MOCK_DEALS = [
  { id: 1n, employer: MOCK_WALLET,   worker: "0xWorker0000000000000000000000000000001",
    terms: "Build a responsive landing page with React and Tailwind. Dark mode, animations, full mobile optimization.",
    budget: "500000000000000000", penalty: "50000000000000000", duration: 604800n, status: 0, created_at: BigInt(Date.now() - 86400000) },
  { id: 2n, employer: "0xOther0000000000000000000000000000Boss1", worker: MOCK_WALLET,
    terms: "Design and develop a Web3 wallet integration module with MetaMask, WalletConnect, and transaction history.",
    budget: "1200000000000000000", penalty: "120000000000000000", duration: 1209600n, status: 1, created_at: BigInt(Date.now() - 172800000) },
  { id: 3n, employer: MOCK_WALLET,   worker: "0xWorker0000000000000000000000000000002",
    terms: "Smart contract audit for DeFi lending protocol. 3 contracts, detailed report with severity ratings.",
    budget: "2000000000000000000", penalty: "200000000000000000", duration: 432000n, status: 2, created_at: BigInt(Date.now() - 259200000) },
];

// ═══════════════════════════════════════════════════════════════════
//  TOAST SYSTEM
// ═══════════════════════════════════════════════════════════════════
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((type, title, message, txHash) => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, type, title, message, txHash }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 8000);
  }, []);
  const remove = useCallback((id) => setToasts(p => p.filter(t => t.id !== id)), []);
  return { toasts, add, remove };
}

function Toast({ toasts, remove }) {
  return (
    <div className="fixed top-5 right-5 z-50 flex flex-col gap-3 w-full max-w-sm pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} style={{ animation: "slideIn 0.3s ease-out" }}
          className={`pointer-events-auto flex flex-col gap-2 p-4 rounded-2xl border backdrop-blur-2xl shadow-2xl ${
            t.type === "success" ? "bg-emerald-950/95 border-emerald-500/40 text-emerald-100" :
            t.type === "error"   ? "bg-red-950/95    border-red-500/40    text-red-100"     :
                                   "bg-slate-900/95  border-blue-500/40   text-blue-100"
          }`}>
          <div className="flex items-start gap-3">
            {t.type === "success" ? <CheckCircle size={16} className="text-emerald-400 shrink-0 mt-0.5" /> :
             t.type === "error"   ? <XCircle     size={16} className="text-red-400    shrink-0 mt-0.5" /> :
                                    <AlertCircle  size={16} className="text-blue-400   shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.message && <p className="text-xs opacity-70 mt-0.5 leading-relaxed">{t.message}</p>}
            </div>
            <button onClick={() => remove(t.id)} className="opacity-40 hover:opacity-80 text-sm leading-none">✕</button>
          </div>
          {/* Copy TX Hash */}
          {t.txHash && (
            <button
              onClick={() => { navigator.clipboard.writeText(t.txHash); }}
              className="flex items-center gap-2 text-xs bg-black/20 hover:bg-black/30 rounded-lg px-3 py-1.5 transition-colors font-mono group"
            >
              <Hash size={11} className="shrink-0" />
              <span className="truncate opacity-70 group-hover:opacity-100">{t.txHash}</span>
              <Copy size={11} className="shrink-0 opacity-50 group-hover:opacity-100" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SHARED UI PRIMITIVES
// ═══════════════════════════════════════════════════════════════════
function Spinner({ size = 14 }) { return <Loader2 size={size} className="animate-spin shrink-0" />; }

function Btn({ children, variant = "primary", loading, icon: Icon, className = "", ...props }) {
  const base = "inline-flex items-center justify-center gap-2 font-semibold text-sm rounded-xl px-5 py-2.5 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95";
  const vs = {
    primary: "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/25 hover:shadow-blue-500/30",
    success: "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/25",
    danger:  "bg-red-700/80 hover:bg-red-600/80 text-white",
    ghost:   "bg-slate-800/60 hover:bg-slate-700/70 border border-slate-700/60 text-slate-300 hover:text-white",
    violet:  "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/25",
  };
  return (
    <button className={`${base} ${vs[variant]} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading ? <Spinner /> : Icon ? <Icon size={14} className="shrink-0" /> : null}
      {children}
    </button>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="text-slate-400 text-[10px] font-bold tracking-widest uppercase">{label}</label>
        {hint && <span className="text-slate-600 text-[10px]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const inputCls = "w-full bg-slate-900/60 border border-slate-700/60 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/20 transition-all";

function Input({ label, hint, as, ...props }) {
  return (
    <Field label={label} hint={hint}>
      {as === "textarea"
        ? <textarea rows={4} className={`${inputCls} resize-none`} {...props} />
        : <input className={inputCls} {...props} />}
    </Field>
  );
}

function StatCard({ icon: Icon, label, value, accent = "blue" }) {
  const c = {
    blue:    "from-blue-600/20    border-blue-500/20    text-blue-400",
    cyan:    "from-cyan-600/20    border-cyan-500/20    text-cyan-400",
    emerald: "from-emerald-600/20 border-emerald-500/20 text-emerald-400",
    violet:  "from-violet-600/20  border-violet-500/20  text-violet-400",
  }[accent];
  return (
    <div className={`relative bg-gradient-to-br ${c} to-transparent border rounded-2xl p-5 overflow-hidden`}>
      <div className="w-9 h-9 rounded-xl bg-current/10 flex items-center justify-center mb-3">
        <Icon size={18} className="opacity-80" />
      </div>
      <p className="text-slate-500 text-[10px] font-bold tracking-widest uppercase mb-1">{label}</p>
      <p className="text-white text-2xl font-bold font-mono">{value}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  DEAL CARD
// ═══════════════════════════════════════════════════════════════════
function DealCard({ deal, walletAddress, onAction }) {
  const [proofUrl, setProofUrl]   = useState("");
  const [tg, setTg]               = useState("");
  const [phone, setPhone]         = useState("");
  const [loading, setLoading]     = useState(null);

  const addr = (a) => typeof a === "string" ? a : String(a ?? "");
  const isEmployer = addr(walletAddress).toLowerCase() === addr(deal.employer).toLowerCase();
  const isWorker   = addr(walletAddress).toLowerCase() === addr(deal.worker).toLowerCase();

  const elapsed  = Number(deal.created_at) > 1e12
    ? (Date.now() - Number(deal.created_at)) / 1000        // ms timestamp
    : (Date.now() / 1000 - Number(deal.created_at));       // s timestamp
  const remaining = Math.max(0, Number(deal.duration) - elapsed);
  const days  = Math.floor(remaining / 86400);
  const hrs   = Math.floor((remaining % 86400) / 3600);
  const mins  = Math.floor((remaining % 3600) / 60);

  const budgetEth  = deal._budgetEth  ?? "—";
  const penaltyEth = deal._penaltyEth ?? "—";
  const st = STATUS[deal.status] ?? { label: "UNKNOWN", color: "text-slate-400 bg-slate-400/10 border-slate-400/20" };

  const handle = async (key, fn) => {
    setLoading(key);
    await fn();
    setLoading(null);
  };

  return (
    <div className="group relative bg-slate-900/50 border border-slate-800/80 rounded-2xl p-6 hover:border-slate-700 transition-all duration-300 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-600/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

      {/* Header row */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-slate-500 text-xs font-mono">#{String(deal.id)}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border tracking-wider ${st.color}`}>
              {st.label}
            </span>
            {isEmployer && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border text-amber-400 bg-amber-400/10 border-amber-400/30 tracking-wider">YOU: EMPLOYER</span>}
            {isWorker   && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border text-cyan-400  bg-cyan-400/10  border-cyan-400/30  tracking-wider">YOU: WORKER</span>}
          </div>
          <p className="text-white text-sm leading-relaxed line-clamp-2">{deal.terms}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-blue-400 font-bold font-mono text-lg">{budgetEth} ETH</p>
          <p className="text-slate-500 text-xs">Penalty: {penaltyEth} ETH</p>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-4 text-xs text-slate-500 mb-5 flex-wrap">
        {remaining > 0
          ? <span className="flex items-center gap-1.5"><Clock size={11} /> {days}d {hrs}h {mins}m remaining</span>
          : <span className="flex items-center gap-1.5 text-red-400"><Clock size={11} /> Expired</span>}
        <span className="font-mono truncate max-w-[160px]" title={addr(deal.employer)}>
          Employer: {addr(deal.employer).slice(0,8)}…
        </span>
        <span className="font-mono truncate max-w-[160px]" title={addr(deal.worker)}>
          Worker: {addr(deal.worker).slice(0,8)}…
        </span>
      </div>

      {/* ── OPEN: Worker accepts ── */}
      {deal.status === 0 && isWorker && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex gap-2 flex-1 min-w-0">
            <input value={tg} onChange={e => setTg(e.target.value)} placeholder="@telegram"
              className="bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-white text-xs w-32 focus:outline-none focus:border-blue-500/50 flex-1" />
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone"
              className="bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-white text-xs w-32 focus:outline-none focus:border-blue-500/50 flex-1" />
          </div>
          <Btn variant="success" icon={CheckCircle} loading={loading === "accept"}
            onClick={() => handle("accept", () => onAction("accept", { did: deal.id, tg, phone }))}>
            Accept & Lock
          </Btn>
        </div>
      )}

      {/* ── ACTIVE: Employer actions ── */}
      {deal.status === 1 && isEmployer && (
        <div className="flex flex-wrap gap-2">
          <Btn variant="success" icon={CheckCircle} loading={loading === "approve"}
            onClick={() => handle("approve", () => onAction("approve", { did: deal.id }))}>
            Approve & Pay Worker
          </Btn>
          <Btn variant="danger" icon={XCircle} loading={loading === "cancel"}
            onClick={() => handle("cancel", () => onAction("cancel", { did: deal.id }))}>
            Cancel with Penalty
          </Btn>
        </div>
      )}

      {/* ── ACTIVE: Worker AI resolution ── */}
      {deal.status === 1 && isWorker && (
        <div className="flex items-center gap-2">
          <input value={proofUrl} onChange={e => setProofUrl(e.target.value)}
            placeholder="https://proof.example.com/evidence"
            className="flex-1 bg-slate-800/60 border border-slate-700/60 rounded-xl px-4 py-2 text-white text-xs focus:outline-none focus:border-violet-500/50" />
          <Btn variant="violet" icon={Brain} loading={loading === "ai"}
            onClick={() => handle("ai", () => onAction("ai", { did: deal.id, proofUrl }))}>
            Request AI Resolution
          </Btn>
        </div>
      )}

      {/* ── Terminal states ── */}
      {deal.status === 2 && (
        <div className="flex items-center gap-2 text-cyan-400 text-xs font-semibold">
          <CheckCircle size={14} /> Deal completed — funds released to worker.
        </div>
      )}
      {deal.status === 3 && (
        <div className="flex items-center gap-2 text-red-400 text-xs font-semibold">
          <XCircle size={14} /> Cancelled by employer — penalty applied and split.
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const { toasts, add: addToast, remove: removeToast } = useToasts();

  const [wallet,       setWallet]       = useState(null);
  const [connecting,   setConnecting]   = useState(false);
  const [demoMode,     setDemoMode]     = useState(true);
  const [activeTab,    setActiveTab]    = useState("dashboard");

  const [deals,        setDeals]        = useState([]);
  const [balance,      setBalance]      = useState("—");
  const [refreshing,   setRefreshing]   = useState(false);
  const [creating,     setCreating]     = useState(false);

  // Create-deal form
  const [form, setForm] = useState({
    workerAddr: "", terms: "", budgetEth: "", penaltyEth: "",
    duration: "", tg: "", phone: ""
  });
  const sf = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  // ── Enrich deal with formatted ETH values ──────────────────────
  const enrichDeal = useCallback(async (raw, id) => {
    const budgetEth  = await fromWei(raw.budget  ?? raw[3] ?? 0n);
    const penaltyEth = await fromWei(raw.penalty ?? raw[4] ?? 0n);
    return {
      id: typeof id === "bigint" ? id : BigInt(id),
      employer:   raw.employer   ?? raw[0],
      worker:     raw.worker     ?? raw[1],
      terms:      raw.terms      ?? raw[2],
      budget:     raw.budget     ?? raw[3],
      penalty:    raw.penalty    ?? raw[4],
      duration:   raw.duration   ?? raw[5],
      status:     Number(raw.status ?? raw[6]),
      created_at: raw.created_at ?? raw[7],
      _budgetEth:  budgetEth,
      _penaltyEth: penaltyEth,
    };
  }, []);

  // ── Connect wallet ─────────────────────────────────────────────
  const connectWallet = async () => {
    if (!window.ethereum) {
      addToast("error", "No Wallet Detected", "Please install MetaMask or another EVM wallet.");
      return;
    }
    setConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      setWallet(accounts[0]);
      setDemoMode(false);
      addToast("success", "Wallet Connected", `${accounts[0].slice(0,6)}…${accounts[0].slice(-4)}`);
    } catch (e) {
      addToast("error", "Connection Rejected", e.message);
    }
    setConnecting(false);
  };

  // ── Load balance ───────────────────────────────────────────────
  const loadBalance = useCallback(async () => {
    if (demoMode) return;
    const b = await ContractService.getContractBalance();
    setBalance(b + " ETH");
  }, [demoMode]);

  useEffect(() => { loadBalance(); }, [loadBalance]);

  // ── Load deals ─────────────────────────────────────────────────
  const loadDeals = useCallback(async () => {
    if (demoMode) {
      // Enrich mock deals
      const enriched = await Promise.all(MOCK_DEALS.map(d => enrichDeal(d, d.id)));
      setDeals(enriched);
      return;
    }
    if (!wallet) return;
    setRefreshing(true);
    try {
      const [wIds, eIds] = await Promise.all([
        ContractService.getDealsForWorker(wallet),
        ContractService.getDealsForEmployer(wallet),
      ]);
      const allIds = [...new Set([...wIds, ...eIds].map(String))].map(BigInt);
      const raws   = await Promise.all(allIds.map(id => ContractService.getDeal(id)));
      const enriched = await Promise.all(raws.map((r, i) => enrichDeal(r, allIds[i])));
      setDeals(enriched);
      loadBalance();
    } catch (e) {
      addToast("error", "Failed to Load Deals", e.message?.slice(0, 120));
    }
    setRefreshing(false);
  }, [demoMode, wallet, enrichDeal, loadBalance, addToast]);

  useEffect(() => { loadDeals(); }, [loadDeals]);

  // Account change listener
  useEffect(() => {
    if (!window.ethereum) return;
    const handler = (accounts) => {
      setWallet(accounts[0] ?? null);
      if (!accounts[0]) { setDemoMode(true); setDeals([]); }
    };
    window.ethereum.on("accountsChanged", handler);
    return () => window.ethereum.removeListener("accountsChanged", handler);
  }, []);

  // ── Create deal ────────────────────────────────────────────────
  const createDeal = async () => {
    if (demoMode) { addToast("info", "Demo Mode Active", "Connect your wallet to create real deals."); return; }
    const { workerAddr, terms, budgetEth, penaltyEth, duration, tg, phone } = form;
    if (!workerAddr || !terms || !budgetEth || !penaltyEth || !duration) {
      addToast("error", "Missing Fields", "Please fill in all required fields."); return;
    }
    setCreating(true);
    try {
      const budgetWei  = await toWei(budgetEth);
      const penaltyWei = await toWei(penaltyEth);
      const { txHash } = await ContractService.createDeal({
        workerAddr, terms, budgetWei, penaltyWei,
        duration: parseInt(duration), tg, phone
      });
      addToast("success", "Deal Created & Deposited!", `msg_value = ${parseFloat(budgetEth) + parseFloat(penaltyEth)} ETH locked.`, txHash);
      setForm({ workerAddr: "", terms: "", budgetEth: "", penaltyEth: "", duration: "", tg: "", phone: "" });
      loadDeals();
    } catch (e) {
      addToast("error", "Transaction Failed", e.reason ?? e.message?.slice(0, 120));
    }
    setCreating(false);
  };

  // ── Deal actions dispatcher ────────────────────────────────────
  const handleAction = async (action, params) => {
    if (demoMode) { addToast("info", "Demo Mode Active", "Connect wallet to execute transactions."); return; }
    const map = {
      accept:  ["acceptDeal",         "Deal Accepted!",              "You are now locked into this deal."],
      approve: ["approveManually",    "Payment Released!",           "Funds sent to worker successfully."],
      cancel:  ["cancelWithPenalty",  "Deal Cancelled with Penalty", "Funds split between parties."],
      ai:      ["requestAIResolution","AI Resolution Requested",     "GenLayer AI is reviewing your case."],
    };
    const [method, title, message] = map[action];
    try {
      const { txHash } = await ContractService[method](params);
      addToast("success", title, message, txHash);
      loadDeals();
    } catch (e) {
      addToast("error", `${title} Failed`, e.reason ?? e.message?.slice(0, 120));
    }
  };

  // ── Derived subsets ────────────────────────────────────────────
  const myAddr    = demoMode ? MOCK_WALLET : (wallet ?? "");
  const openDeals = deals.filter(d => d.status === 0);
  const activeD   = deals.filter(d => d.status === 1);
  const shortAddr = wallet ? `${wallet.slice(0,6)}…${wallet.slice(-4)}` : null;

  const TABS = [
    { id: "dashboard", label: "Overview" },
    { id: "create",    label: "Create Deal" },
    { id: "worker",    label: `Open Deals (${openDeals.length})` },
    { id: "active",    label: `Active (${activeD.length})` },
  ];

  // ═════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen text-white" style={{
      background: "radial-gradient(ellipse 90% 50% at 50% -10%, #0b1e3d 0%, #060a12 70%)",
      fontFamily: "'DM Mono', 'JetBrains Mono', monospace"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,400&family=Syne:wght@700;800&display=swap');
        .font-display { font-family: 'Syne', sans-serif; }
        @keyframes slideIn { from { opacity:0; transform: translateX(16px); } to { opacity:1; transform: translateX(0); } }
        @keyframes fadeUp  { from { opacity:0; transform: translateY(10px); } to { opacity:1; transform: translateY(0); } }
        .animate-in  { animation: fadeUp  0.35s ease-out forwards; }
        .grid-bg {
          background-image:
            linear-gradient(rgba(56,130,246,0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(56,130,246,0.035) 1px, transparent 1px);
          background-size: 52px 52px;
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: rgba(59,130,246,0.25); border-radius: 4px; }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
      `}</style>

      <div className="grid-bg fixed inset-0 pointer-events-none opacity-60" />
      <Toast toasts={toasts} remove={removeToast} />

      {/* ── HEADER ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-slate-800/60 backdrop-blur-2xl bg-slate-950/80">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-4">

          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-600/15 border border-blue-500/25 flex items-center justify-center">
              <Shield size={15} className="text-blue-400" />
            </div>
            <div className="leading-none">
              <p className="font-display text-white font-bold text-[15px] tracking-tight">Universal AI Escrow</p>
              <p className="text-blue-500/50 text-[9px] tracking-widest uppercase">Powered by GenLayer</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {demoMode && (
              <span className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full border text-[9px] font-bold tracking-widest uppercase text-amber-400 bg-amber-400/8 border-amber-400/20">
                <Zap size={9} /> Demo Mode
              </span>
            )}
            {wallet ? (
              <div className="flex items-center gap-2 bg-emerald-950/50 border border-emerald-500/25 rounded-xl px-3 py-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-300 text-xs font-mono">{shortAddr}</span>
                <button onClick={() => { navigator.clipboard.writeText(wallet); addToast("info","Copied","Address copied to clipboard."); }}
                  className="text-emerald-500/60 hover:text-emerald-300 transition-colors">
                  <Copy size={11} />
                </button>
              </div>
            ) : (
              <Btn variant="primary" icon={Wallet} loading={connecting} onClick={connectWallet}>
                Connect Wallet
              </Btn>
            )}
          </div>
        </div>
      </header>

      {/* ── TAB BAR ────────────────────────────────────────────── */}
      <div className="sticky top-16 z-30 border-b border-slate-800/50 backdrop-blur-xl bg-slate-950/50">
        <div className="max-w-6xl mx-auto px-5 flex gap-0.5">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-5 py-3.5 text-[10px] font-bold tracking-widest uppercase transition-all border-b-2 ${
                activeTab === t.id
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── MAIN ───────────────────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-5 py-10">

        {/* ░░░ OVERVIEW ░░░ */}
        {activeTab === "dashboard" && (
          <div className="animate-in space-y-10">
            <div>
              <h1 className="font-display text-3xl font-bold text-white mb-2">Command Center</h1>
              <p className="text-slate-400 text-sm">AI-arbitrated escrow contracts for trustless freelance agreements on GenLayer.</p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={DollarSign} label="Contract Balance"  value={balance}             accent="blue" />
              <StatCard icon={Activity}   label="Total Deals"       value={deals.length}        accent="cyan" />
              <StatCard icon={Clock}      label="Active"            value={activeD.length}      accent="emerald" />
              <StatCard icon={Brain}      label="AI Arbitrations"   value={deals.filter(d=>d.status===2).length} accent="violet" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-xl font-bold text-white">All Deals</h2>
                <Btn variant="ghost" icon={RefreshCw} loading={refreshing} onClick={loadDeals}>Refresh</Btn>
              </div>
              {deals.length === 0
                ? <Empty icon={Activity} title="No deals yet" sub="Create a deal or connect your wallet." />
                : <div className="space-y-4">{deals.map(d => <DealCard key={String(d.id)} deal={d} walletAddress={myAddr} onAction={handleAction} />)}</div>}
            </div>

            {/* How it works */}
            <div className="bg-slate-900/30 border border-slate-800/60 rounded-2xl p-6">
              <h3 className="font-display text-lg font-bold text-white mb-6 flex items-center gap-2">
                <Brain size={17} className="text-violet-400" /> How It Works
              </h3>
              <div className="grid sm:grid-cols-3 gap-6">
                {[
                  { n:"01", icon: Plus,         title:"Employer Creates",      body:"Deposits budget + penalty into the smart contract. msg_value = budget + penalty ensures both are locked on-chain." },
                  { n:"02", icon: CheckCircle,  title:"Worker Accepts",        body:"Worker provides Telegram & phone, locks into the deal. Funds are held trustlessly until resolution." },
                  { n:"03", icon: Brain,        title:"AI Arbitrates Disputes",body:"Worker submits proof URL. GenLayer's AI reads the evidence and executes a fair, automated ruling." },
                ].map(s => (
                  <div key={s.n} className="flex gap-4">
                    <div className="w-8 h-8 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <s.icon size={14} className="text-blue-400" />
                    </div>
                    <div>
                      <span className="text-blue-500/50 text-[9px] font-bold tracking-widest">STEP {s.n}</span>
                      <p className="text-white font-semibold text-sm mb-1">{s.title}</p>
                      <p className="text-slate-400 text-xs leading-relaxed">{s.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ░░░ CREATE DEAL ░░░ */}
        {activeTab === "create" && (
          <div className="animate-in max-w-2xl">
            <h1 className="font-display text-3xl font-bold text-white mb-2">Create Escrow Deal</h1>
            <p className="text-slate-400 text-sm mb-8">
              Deploy a new deal. <strong className="text-blue-400">msg_value</strong> sent to the contract will equal Budget + Penalty.
            </p>

            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 space-y-5">

              <Input label="Worker Address *" placeholder="0x…" value={form.workerAddr} onChange={sf("workerAddr")} />
              <Input as="textarea" label="Terms of Work *" placeholder="Describe deliverables, acceptance criteria, and timeline in detail…" value={form.terms} onChange={sf("terms")} />

              <div className="grid grid-cols-2 gap-4">
                <Input label="Budget (ETH) *"  type="number" step="0.001" placeholder="0.5"  value={form.budgetEth}  onChange={sf("budgetEth")} />
                <Input label="Penalty (ETH) *" type="number" step="0.001" placeholder="0.05" value={form.penaltyEth} onChange={sf("penaltyEth")} />
              </div>

              <Input label="Duration (seconds) *" type="number" hint="— e.g. 604800 = 7 days" placeholder="604800" value={form.duration} onChange={sf("duration")} />

              <div className="grid grid-cols-2 gap-4">
                <Input label="Your Telegram" placeholder="@handle" value={form.tg}    onChange={sf("tg")} />
                <Input label="Your Phone"    placeholder="+1 555…"  value={form.phone} onChange={sf("phone")} />
              </div>

              {/* Value preview */}
              {form.budgetEth && form.penaltyEth && (
                <div className="flex items-start gap-3 bg-blue-950/30 border border-blue-500/20 rounded-xl px-4 py-3">
                  <Info size={15} className="text-blue-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-blue-300 leading-relaxed">
                    <p><strong>msg_value</strong> = {parseFloat(form.budgetEth||0) + parseFloat(form.penaltyEth||0)} ETH will be sent to the contract</p>
                    <p className="text-blue-400/60 mt-0.5">Budget ({form.budgetEth} ETH) + Penalty ({form.penaltyEth} ETH) locked on-chain until resolution.</p>
                  </div>
                </div>
              )}

              <Btn variant="primary" icon={Shield} loading={creating} className="w-full py-3 text-base" onClick={createDeal}>
                Create & Deposit to Escrow
              </Btn>
            </div>
          </div>
        )}

        {/* ░░░ WORKER (open deals) ░░░ */}
        {activeTab === "worker" && (
          <div className="animate-in">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="font-display text-3xl font-bold text-white mb-2">Open Deals Assigned to Me</h1>
                <p className="text-slate-400 text-sm">OPEN deals where you are the worker. Accept to lock funds and start work.</p>
              </div>
              <Btn variant="ghost" icon={RefreshCw} loading={refreshing} onClick={loadDeals}>Refresh</Btn>
            </div>
            {openDeals.length === 0
              ? <Empty icon={Eye} title="No open deals" sub="Deals assigned to your address will appear here." />
              : <div className="space-y-4">{openDeals.map(d => <DealCard key={String(d.id)} deal={d} walletAddress={myAddr} onAction={handleAction} />)}</div>}
          </div>
        )}

        {/* ░░░ ACTIVE ░░░ */}
        {activeTab === "active" && (
          <div className="animate-in">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="font-display text-3xl font-bold text-white mb-2">Active Deals</h1>
                <p className="text-slate-400 text-sm">
                  Employers: Approve or Cancel. &nbsp;Workers: Submit proof and request AI resolution.
                </p>
              </div>
              <Btn variant="ghost" icon={RefreshCw} loading={refreshing} onClick={loadDeals}>Refresh</Btn>
            </div>
            {deals.filter(d=>d.status>=1).length === 0
              ? <Empty icon={Activity} title="No active deals" sub="Accepted deals will appear here." />
              : <div className="space-y-4">{deals.filter(d=>d.status>=1).map(d => <DealCard key={String(d.id)} deal={d} walletAddress={myAddr} onAction={handleAction} />)}</div>}
          </div>
        )}
      </main>

      {/* ── FOOTER ─────────────────────────────────────────────── */}
      <footer className="border-t border-slate-800/40 mt-20 py-8">
        <div className="max-w-6xl mx-auto px-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-slate-600 text-xs">
            <Shield size={12} className="text-blue-600" />
            Universal AI Escrow — GenLayer
          </div>
          <code className="text-slate-700 text-[10px] truncate max-w-xs">
            {CONTRACT_CONFIG.address}
          </code>
        </div>
      </footer>
    </div>
  );
}

// ── Empty state helper ──────────────────────────────────────────────
function Empty({ icon: Icon, title, sub }) {
  return (
    <div className="text-center py-24 text-slate-500">
      <Icon size={36} className="mx-auto mb-4 opacity-20" />
      <p className="font-semibold text-base mb-1">{title}</p>
      <p className="text-sm">{sub}</p>
    </div>
  );
}
