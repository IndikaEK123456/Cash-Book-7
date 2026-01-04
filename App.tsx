
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  DeviceRole, 
  PaymentMethod, 
  AppState, 
  OutPartyEntry, 
  MainEntry,
  DailyData
} from './types';
import { STORAGE_KEY, DEFAULT_LKR_USD, DEFAULT_LKR_EURO } from './constants';
import { calculateTotals } from './utils/calculations';
import { fetchLiveExchangeRates } from './services/geminiService';

declare const Peer: any;

const createDefaultDay = (openingBalance: number = 0): DailyData => ({
  date: new Date().toLocaleDateString('en-GB'),
  outPartyEntries: [],
  mainEntries: [],
  openingBalance
});

const App: React.FC = () => {
  const [isInitializing, setIsInitializing] = useState(true);
  const [role, setRole] = useState<DeviceRole>(DeviceRole.MOBILE);
  const [syncStatus, setSyncStatus] = useState<'offline' | 'online' | 'syncing' | 'error'>('offline');
  const [appState, setAppState] = useState<AppState>({
    currentDay: createDefaultDay(),
    history: [],
    cabinId: '',
    rates: { usd: DEFAULT_LKR_USD, euro: DEFAULT_LKR_EURO },
    isPaired: false
  });

  const peerRef = useRef<any>(null);
  const connectionsRef = useRef<any[]>([]);
  const stateRef = useRef(appState);
  const reconnectTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    stateRef.current = appState;
  }, [appState]);

  // 1. BOOTSTRAP
  useEffect(() => {
    try {
      const savedRole = localStorage.getItem('shivas_role') as DeviceRole;
      if (savedRole) setRole(savedRole);
      else setRole(window.innerWidth < 1024 ? DeviceRole.MOBILE : DeviceRole.LAPTOP);

      const savedData = localStorage.getItem(STORAGE_KEY);
      if (savedData) {
        const parsed = JSON.parse(savedData);
        setAppState(prev => ({
          ...prev,
          ...parsed,
          currentDay: {
            ...createDefaultDay(),
            ...(parsed.currentDay || {}),
            outPartyEntries: Array.isArray(parsed.currentDay?.outPartyEntries) ? parsed.currentDay.outPartyEntries : [],
            mainEntries: Array.isArray(parsed.currentDay?.mainEntries) ? parsed.currentDay.mainEntries : []
          }
        }));
      }
    } catch (e) {
      console.error("Boot Failure", e);
    } finally {
      setIsInitializing(false);
    }
  }, []);

  // 2. REFINED SYNC ENGINE (PeerJS with STUN)
  const broadcastState = useCallback((state: AppState) => {
    connectionsRef.current.forEach(conn => {
      if (conn.open) {
        conn.send({ type: 'SYNC_STATE', state });
      }
    });
  }, []);

  const initializePeer = useCallback((id: string, isMaster: boolean) => {
    if (peerRef.current) return; // Prevent multiple instances

    setSyncStatus('syncing');
    const peerId = `SHIVAS_MASTER_${id.replace(/\s/g, '_')}`;
    
    // MASTER-CLASS P2P CONFIGURATION
    const peer = new Peer(isMaster ? peerId : undefined, {
      debug: 1, // Minimize noise, only errors
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
        ]
      },
      // Explicitly set for Vercel/HTTPS
      secure: true,
      port: 443
    });

    peerRef.current = peer;

    peer.on('open', (pid: string) => {
      console.log(`P2P Handshake Ready. Peer ID: ${pid}`);
      setSyncStatus('online');
      
      if (!isMaster) {
        // Mobile attempts to connect to the specific Laptop ID
        const conn = peer.connect(peerId, {
          reliable: true
        });
        setupConnection(conn);
      }
    });

    peer.on('connection', (conn: any) => {
      // Laptop side: receiving connection from Mobile
      setupConnection(conn);
      // Push state immediately upon handshake
      setTimeout(() => conn.send({ type: 'SYNC_STATE', state: stateRef.current }), 800);
    });

    peer.on('error', (err: any) => {
      console.error("P2P System Error:", err.type);
      setSyncStatus('error');
      
      // Handle "ID taken" (Laptop already running elsewhere or refresh conflict)
      if (err.type === 'id-taken' && isMaster) {
        alert("CRITICAL: Sync ID is already active. Please use a unique Cabin ID or close other tabs.");
      }

      // Cleanup and try to revive connection after a delay
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = window.setTimeout(() => {
        if (peerRef.current) {
          peerRef.current.destroy();
          peerRef.current = null;
          initializePeer(id, isMaster);
        }
      }, 5000);
    });

    peer.on('disconnected', () => {
      setSyncStatus('offline');
      peer.reconnect();
    });

    function setupConnection(conn: any) {
      conn.on('open', () => {
        console.log("Device-to-Device Linked!");
        connectionsRef.current.push(conn);
        setSyncStatus('online');
      });

      conn.on('data', (data: any) => {
        if (data.type === 'SYNC_STATE') {
          // Prevent infinite update loops by checking date stamps or content equality
          setAppState(prev => {
             const incoming = JSON.stringify(data.state);
             const current = JSON.stringify(prev);
             return incoming !== current ? { ...prev, ...data.state } : prev;
          });
        }
      });

      conn.on('close', () => {
        console.warn("Remote Connection Closed");
        connectionsRef.current = connectionsRef.current.filter(c => c !== conn);
        if (connectionsRef.current.length === 0) setSyncStatus('offline');
      });
    }
  }, []);

  useEffect(() => {
    if (appState.isPaired) {
      initializePeer(appState.cabinId, role === DeviceRole.LAPTOP);
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    
    if (role === DeviceRole.LAPTOP) {
      broadcastState(appState);
    }
  }, [appState, role, initializePeer, broadcastState]);

  // 3. HANDLERS
  const updateRole = (newRole: DeviceRole) => {
    if (role === newRole) return;
    setRole(newRole);
    localStorage.setItem('shivas_role', newRole);
    // Hard refresh P2P on role swap
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
      connectionsRef.current = [];
    }
  };

  const pairDevice = (id: string) => {
    const cleanId = id.trim().toUpperCase();
    if (!cleanId) return;
    setAppState(prev => ({ ...prev, cabinId: cleanId, isPaired: true }));
  };

  const isLaptop = role === DeviceRole.LAPTOP;
  const totals = useMemo(() => calculateTotals(appState.currentDay), [appState.currentDay]);

  const addOutParty = () => {
    if (!isLaptop) return;
    const entry: OutPartyEntry = {
      id: crypto.randomUUID(),
      index: appState.currentDay.outPartyEntries.length + 1,
      method: PaymentMethod.CASH,
      amount: 0
    };
    setAppState(prev => ({
      ...prev,
      currentDay: { ...prev.currentDay, outPartyEntries: [...prev.currentDay.outPartyEntries, entry] }
    }));
  };

  const updateOutParty = (id: string, field: keyof OutPartyEntry, value: any) => {
    if (!isLaptop) return;
    setAppState(prev => ({
      ...prev,
      currentDay: {
        ...prev.currentDay,
        outPartyEntries: prev.currentDay.outPartyEntries.map(e => e.id === id ? { ...e, [field]: value } : e)
      }
    }));
  };

  const addMainEntry = () => {
    if (!isLaptop) return;
    const entry: MainEntry = {
      id: crypto.randomUUID(),
      roomNo: '',
      description: '',
      method: PaymentMethod.CASH,
      cashIn: 0,
      cashOut: 0
    };
    setAppState(prev => ({
      ...prev,
      currentDay: { ...prev.currentDay, mainEntries: [...prev.currentDay.mainEntries, entry] }
    }));
  };

  const updateMainEntry = (id: string, field: keyof MainEntry, value: any) => {
    if (!isLaptop) return;
    setAppState(prev => ({
      ...prev,
      currentDay: {
        ...prev.currentDay,
        mainEntries: prev.currentDay.mainEntries.map(e => e.id === id ? { ...e, [field]: value } : e)
      }
    }));
  };

  const deleteRecord = (id: string, section: 'OP' | 'MAIN') => {
    if (!isLaptop) return;
    if (!window.confirm("Permanent Delete?")) return;
    setAppState(prev => {
      const nextDay = { ...prev.currentDay };
      if (section === 'OP') nextDay.outPartyEntries = nextDay.outPartyEntries.filter(e => e.id !== id);
      else nextDay.mainEntries = nextDay.mainEntries.filter(e => e.id !== id);
      return { ...prev, currentDay: nextDay };
    });
  };

  const handleDayEnd = () => {
    if (!isLaptop || !window.confirm("Archive book and start fresh?")) return;
    setAppState(prev => ({
      ...prev,
      history: [prev.currentDay, ...prev.history],
      currentDay: createDefaultDay(totals.finalBalance)
    }));
  };

  if (isInitializing) return null;

  // --- PAIRING SCREEN ---
  if (!appState.isPaired) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md glass-card p-10 rounded-[3rem] shadow-2xl border border-white/10 text-center space-y-10 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-sky-500 to-transparent"></div>
          <div>
            <h1 className="text-5xl font-black text-white tracking-tighter italic uppercase mb-2">SHIVAS</h1>
            <p className="text-sky-500 text-[10px] font-black uppercase tracking-[0.5em]">Stable Live Connection</p>
          </div>
          <div className="space-y-4">
            <input 
              type="text" 
              placeholder="SYNC ID" 
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-6 text-white font-bold text-center focus:ring-4 ring-sky-500/20 outline-none uppercase text-2xl placeholder:opacity-20"
              onKeyDown={(e) => e.key === 'Enter' && pairDevice((e.target as HTMLInputElement).value)}
            />
            <button 
              onClick={() => pairDevice((document.querySelector('input') as HTMLInputElement).value)}
              className="w-full bg-white text-black font-black py-6 rounded-2xl transition-all active:scale-95 text-xl shadow-xl hover:bg-sky-50"
            >
              START SYNC
            </button>
          </div>
          <p className="text-slate-500 text-[9px] font-bold px-8 leading-relaxed uppercase tracking-widest">
            Enter the same ID on Laptop and Mobile to connect them across the globe.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col font-medium selection:bg-sky-500/20">
      <header className="sticky top-0 z-[100] glass-card border-x-0 border-t-0 py-5 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex flex-col">
            <h1 className="text-2xl font-black tracking-tighter italic uppercase text-white leading-none">SHIVAS BEACH</h1>
            <div className="flex gap-4 text-[9px] font-black uppercase tracking-widest text-slate-500 mt-2">
              <span className="text-sky-400">{appState.currentDay.date}</span>
              <span className="bg-white/5 px-2 py-0.5 rounded text-white/50">USD: {appState.rates.usd}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${syncStatus === 'online' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : syncStatus === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
               <span className={`status-dot ${syncStatus === 'online' ? 'status-online' : syncStatus === 'syncing' ? 'status-syncing' : 'status-offline'}`}></span>
               <span className="text-[10px] font-black uppercase tracking-widest">{syncStatus === 'online' ? 'Stable' : syncStatus === 'error' ? 'Retry' : 'Linking...'}</span>
            </div>
            <select 
              value={role} 
              onChange={(e) => updateRole(e.target.value as DeviceRole)}
              className="bg-white/5 text-white text-[10px] font-black uppercase py-2 px-3 rounded-lg border border-white/10 outline-none cursor-pointer"
            >
              <option value={DeviceRole.LAPTOP} className="bg-slate-900">💻 Laptop</option>
              <option value={DeviceRole.MOBILE} className="bg-slate-900">📱 Mobile</option>
            </select>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-10 space-y-12">
        <section className={`glass-card rounded-[2.5rem] overflow-hidden ${isLaptop ? 'master-glow' : ''}`}>
          <div className="px-8 py-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
            <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.4em]">External Out Party</h2>
            {isLaptop && (
              <button onClick={addOutParty} className="bg-sky-500 hover:bg-sky-400 text-black text-[10px] font-black px-5 py-2.5 rounded-xl transition-all">+ ADD ENTRY</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-white/5">
                  <th className="px-8 py-4 w-16">No</th>
                  <th className="px-8 py-4">Method</th>
                  <th className="px-8 py-4">Amount (LKR)</th>
                  {isLaptop && <th className="px-8 py-4 w-16"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {appState.currentDay.outPartyEntries.map((e, i) => (
                  <tr key={e.id} className="hover:bg-white/[0.01] transition-colors">
                    <td className="px-8 py-6 text-slate-600 font-black">{i + 1}</td>
                    <td className="px-8 py-6">
                      {isLaptop ? (
                        <select 
                          value={e.method} 
                          onChange={(ev) => updateOutParty(e.id, 'method', ev.target.value as PaymentMethod)}
                          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-white outline-none"
                        >
                          <option value={PaymentMethod.CASH} className="bg-slate-900">CASH</option>
                          <option value={PaymentMethod.CARD} className="bg-slate-900">CARD</option>
                          <option value={PaymentMethod.PAYPAL} className="bg-slate-900">PAYPAL</option>
                        </select>
                      ) : <span className="text-[10px] font-black text-slate-400">{e.method}</span>}
                    </td>
                    <td className="px-8 py-6">
                      {isLaptop ? (
                        <input 
                          type="number" 
                          value={e.amount || ''} 
                          onChange={(ev) => updateOutParty(e.id, 'amount', Number(ev.target.value))}
                          className="w-full bg-transparent text-3xl font-black text-white outline-none focus:text-sky-400"
                        />
                      ) : <span className="text-3xl font-black text-white">Rs {e.amount.toLocaleString()}</span>}
                    </td>
                    {isLaptop && (
                      <td className="px-8 py-6">
                        <button onClick={() => deleteRecord(e.id, 'OP')} className="text-white/10 hover:text-red-500 transition-colors">
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 bg-white/[0.03]">
             <div className="p-8 border-r border-white/5 text-center">
                <p className="text-[9px] font-black text-sky-500 uppercase tracking-widest mb-1">Total Cash</p>
                <p className="text-2xl font-black">Rs {totals.opCash.toLocaleString()}</p>
             </div>
             <div className="p-8 border-r border-white/5 text-center">
                <p className="text-[9px] font-black text-yellow-500 uppercase tracking-widest mb-1">Total Card</p>
                <p className="text-2xl font-black text-yellow-500">Rs {totals.opCard.toLocaleString()}</p>
             </div>
             <div className="p-8 text-center">
                <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest mb-1">Total PayPal</p>
                <p className="text-2xl font-black text-purple-400">Rs {totals.opPaypal.toLocaleString()}</p>
             </div>
          </div>
        </section>

        <section className={`glass-card rounded-[2.5rem] overflow-hidden ${isLaptop ? 'master-glow' : ''}`}>
          <div className="px-8 py-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
            <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.4em]">Master Cash Ledger</h2>
            {isLaptop && (
              <button onClick={addMainEntry} className="bg-emerald-500 hover:bg-emerald-400 text-black text-[10px] font-black px-5 py-2.5 rounded-xl transition-all">+ NEW FLOW</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[1000px]">
              <thead>
                <tr className="text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-white/5">
                  <th className="px-8 py-4 w-24">Room</th>
                  <th className="px-8 py-4">Details</th>
                  <th className="px-8 py-4 w-32">Type</th>
                  <th className="px-8 py-4 w-44">In (LKR)</th>
                  <th className="px-8 py-4 w-44">Out (LKR)</th>
                  {isLaptop && <th className="px-8 py-4 w-16"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {appState.currentDay.mainEntries.map(e => (
                  <tr key={e.id} className="hover:bg-white/[0.01] transition-colors">
                    <td className="px-8 py-6">
                      {isLaptop ? (
                        <input value={e.roomNo} onChange={(ev) => updateMainEntry(e.id, 'roomNo', ev.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs font-bold text-white outline-none" placeholder="RM#"/>
                      ) : <span className="font-black text-white">{e.roomNo}</span>}
                    </td>
                    <td className="px-8 py-6">
                      {isLaptop ? (
                        <input value={e.description} onChange={(ev) => updateMainEntry(e.id, 'description', ev.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs font-bold text-white outline-none" placeholder="Description..."/>
                      ) : <span className="text-sm font-bold text-slate-400">{e.description}</span>}
                    </td>
                    <td className="px-8 py-6">
                       {isLaptop ? (
                        <select value={e.method} onChange={(ev) => updateMainEntry(e.id, 'method', ev.target.value as PaymentMethod)} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs font-bold text-white outline-none">
                          <option value={PaymentMethod.CASH} className="bg-slate-900">CASH</option>
                          <option value={PaymentMethod.CARD} className="bg-slate-900">CARD</option>
                          <option value={PaymentMethod.PAYPAL} className="bg-slate-900">PAYPAL</option>
                        </select>
                      ) : <span className="text-[10px] font-black text-slate-600">{e.method}</span>}
                    </td>
                    <td className="px-8 py-6">
                      {isLaptop ? (
                        <input type="number" value={e.cashIn || ''} onChange={(ev) => updateMainEntry(e.id, 'cashIn', Number(ev.target.value))} className="w-full bg-sky-500/5 text-sky-400 p-2 text-xl font-black outline-none rounded-lg" placeholder="0"/>
                      ) : <span className="text-xl font-black text-sky-400">{e.cashIn > 0 ? `Rs ${e.cashIn.toLocaleString()}` : ''}</span>}
                    </td>
                    <td className="px-8 py-6">
                      {isLaptop ? (
                        <input type="number" value={e.cashOut || ''} onChange={(ev) => updateMainEntry(e.id, 'cashOut', Number(ev.target.value))} className="w-full bg-red-500/5 text-red-400 p-2 text-xl font-black outline-none rounded-lg" placeholder="0"/>
                      ) : <span className="text-xl font-black text-red-400">{e.cashOut > 0 ? `Rs ${e.cashOut.toLocaleString()}` : ''}</span>}
                    </td>
                    {isLaptop && (
                      <td className="px-8 py-6">
                        <button onClick={() => deleteRecord(e.id, 'MAIN')} className="text-white/10 hover:text-red-500 transition-colors">
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 p-8 gap-8 bg-black/40">
             <div className="text-center">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Total Card</p>
                <p className="text-xl font-black text-white">Rs {totals.mainCardTotal.toLocaleString()}</p>
             </div>
             <div className="text-center">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Total PayPal</p>
                <p className="text-xl font-black text-white">Rs {totals.mainPaypalTotal.toLocaleString()}</p>
             </div>
             <div className="text-center bg-sky-500/10 py-5 rounded-3xl">
                <p className="text-[9px] font-black text-sky-400 uppercase tracking-widest">Cash In Sum</p>
                <p className="text-2xl font-black text-sky-300">Rs {totals.mainCashInTotal.toLocaleString()}</p>
             </div>
             <div className="text-center bg-red-500/10 py-5 rounded-3xl">
                <p className="text-[9px] font-black text-red-500 uppercase tracking-widest">Cash Out Sum</p>
                <p className="text-2xl font-black text-red-400">Rs {totals.mainCashOutTotal.toLocaleString()}</p>
             </div>
          </div>
        </section>

        <section className="relative">
          <div className="absolute -inset-1 bg-gradient-to-r from-sky-500 to-emerald-500 rounded-[4rem] blur opacity-20"></div>
          <div className="relative glass-card bg-slate-900/90 rounded-[4rem] p-12 md:p-24 flex flex-col md:flex-row items-center justify-between gap-12 overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-sky-500/10 blur-[100px] rounded-full"></div>
            <div className="text-center md:text-left">
              <h3 className="text-[10px] font-black text-sky-500 uppercase tracking-[0.6em] mb-4">Total Net Liquidity</h3>
              <div className="text-6xl md:text-[9rem] font-black text-white tracking-tighter leading-none italic tabular-nums">
                Rs {totals.finalBalance.toLocaleString()}
              </div>
            </div>
            {isLaptop && (
              <button 
                onClick={handleDayEnd}
                className="bg-white text-black px-16 py-8 rounded-[2rem] font-black text-2xl shadow-2xl hover:scale-105 active:scale-95 transition-all uppercase tracking-tighter italic"
              >
                Day End Close
              </button>
            )}
          </div>
        </section>
      </main>

      <footer className="fixed bottom-0 left-0 w-full p-4 flex justify-between items-center pointer-events-none z-[200]">
        <div className="glass-card px-5 py-3 rounded-2xl border border-white/10 pointer-events-auto flex items-center gap-3">
           <div className={`status-dot ${syncStatus === 'online' ? 'status-online' : syncStatus === 'syncing' ? 'status-syncing' : 'status-offline'}`}></div>
           <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Sync ID: <span className="text-white">{appState.cabinId}</span></span>
        </div>
        
        <button 
          onClick={() => {
            if (appState.history.length === 0) return alert("Archive empty.");
            const s = appState.history.map(h => `${h.date}: Rs ${calculateTotals(h).finalBalance.toLocaleString()}`).join('\n');
            alert(`LEDGER HISTORY:\n\n${s}`);
          }}
          className="glass-card px-6 py-3 rounded-2xl border border-white/10 pointer-events-auto text-[9px] font-black uppercase tracking-widest text-white/50 hover:text-white transition-all flex items-center gap-2"
        >
          <svg className="w-4 h-4 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          Archive ({appState.history.length})
        </button>
      </footer>
    </div>
  );
};

export default App;
