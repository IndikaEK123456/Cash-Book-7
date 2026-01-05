
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

  // Connectivity context tracking
  useEffect(() => {
    stateRef.current = appState;
  }, [appState]);

  // 1. BOOTSTRAP (KEEP UNCHANGED)
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

  // 2. STABLE P2P SYNC ENGINE (REMAINING UNTOUCHED AS REQUESTED)
  const broadcastState = useCallback((state: AppState) => {
    connectionsRef.current.forEach(conn => {
      if (conn.open) {
        conn.send({ type: 'SYNC_STATE', state });
      }
    });
  }, []);

  const initializePeer = useCallback((id: string, isMaster: boolean) => {
    if (peerRef.current) return;
    setSyncStatus('syncing');
    const peerId = `SHIVAS_MASTER_${id.replace(/\s/g, '_')}`;
    const peer = new Peer(isMaster ? peerId : undefined, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
        ]
      },
      secure: true,
      port: 443
    });
    peerRef.current = peer;
    peer.on('open', (pid: string) => {
      setSyncStatus('online');
      if (!isMaster) {
        const conn = peer.connect(peerId, { reliable: true });
        setupConnection(conn);
      }
    });
    peer.on('connection', (conn: any) => {
      setupConnection(conn);
      setTimeout(() => conn.send({ type: 'SYNC_STATE', state: stateRef.current }), 800);
    });
    peer.on('error', (err: any) => {
      setSyncStatus('error');
      if (err.type === 'id-taken' && isMaster) alert("Sync ID already active.");
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = window.setTimeout(() => {
        if (peerRef.current) {
          peerRef.current.destroy();
          peerRef.current = null;
          initializePeer(id, isMaster);
        }
      }, 5000);
    });
    peer.on('disconnected', () => { setSyncStatus('offline'); peer.reconnect(); });
    function setupConnection(conn: any) {
      conn.on('open', () => { connectionsRef.current.push(conn); setSyncStatus('online'); });
      conn.on('data', (data: any) => {
        if (data.type === 'SYNC_STATE') {
          setAppState(prev => {
             const incoming = JSON.stringify(data.state);
             const current = JSON.stringify(prev);
             return incoming !== current ? { ...prev, ...data.state } : prev;
          });
        }
      });
      conn.on('close', () => {
        connectionsRef.current = connectionsRef.current.filter(c => c !== conn);
        if (connectionsRef.current.length === 0) setSyncStatus('offline');
      });
    }
  }, []);

  useEffect(() => {
    if (appState.isPaired) initializePeer(appState.cabinId, role === DeviceRole.LAPTOP);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    if (role === DeviceRole.LAPTOP) broadcastState(appState);
  }, [appState, role, initializePeer, broadcastState]);

  // 3. CURRENCY UPDATE (USD & EURO)
  useEffect(() => {
    const syncRates = async () => {
      const freshRates = await fetchLiveExchangeRates();
      setAppState(prev => ({ ...prev, rates: freshRates }));
    };
    syncRates();
  }, []);

  // 4. HANDLERS
  const updateRole = (newRole: DeviceRole) => {
    if (role === newRole) return;
    setRole(newRole);
    localStorage.setItem('shivas_role', newRole);
    if (peerRef.current) { peerRef.current.destroy(); peerRef.current = null; connectionsRef.current = []; }
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
    if (!window.confirm("Delete record?")) return;
    setAppState(prev => {
      const nextDay = { ...prev.currentDay };
      if (section === 'OP') nextDay.outPartyEntries = nextDay.outPartyEntries.filter(e => e.id !== id);
      else nextDay.mainEntries = nextDay.mainEntries.filter(e => e.id !== id);
      return { ...prev, currentDay: nextDay };
    });
  };

  const handleDayEnd = () => {
    if (!isLaptop || !window.confirm("Archive book?")) return;
    setAppState(prev => ({
      ...prev,
      history: [prev.currentDay, ...prev.history],
      currentDay: createDefaultDay(totals.finalBalance)
    }));
  };

  if (isInitializing) return null;

  // --- LOGIN ---
  if (!appState.isPaired) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md glass-card p-8 rounded-[2rem] text-center space-y-8 shadow-2xl">
          <h1 className="text-4xl font-black text-white italic uppercase tracking-tighter">SHIVAS</h1>
          <div className="space-y-4">
            <input 
              type="text" 
              placeholder="SYNC ID" 
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white font-bold text-center outline-none uppercase text-xl focus:ring-2 ring-sky-500/50"
              onKeyDown={(e) => e.key === 'Enter' && pairDevice((e.target as HTMLInputElement).value)}
            />
            <button onClick={() => pairDevice((document.querySelector('input') as HTMLInputElement).value)} className="w-full bg-white text-black font-black py-4 rounded-xl transition-all active:scale-95 text-lg">START SYNC</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#020617] text-slate-100 font-medium overflow-hidden">
      {/* HEADER: COMPACT WITH DUAL CURRENCY */}
      <header className="glass-card border-x-0 border-t-0 py-2 px-4 flex-shrink-0 z-50">
        <div className="max-w-full mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm md:text-base font-[900] tracking-tighter italic uppercase text-white whitespace-nowrap">SHIVAS BEACH</h1>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              <span className="flex items-center gap-1.5 bg-sky-500/10 px-2 py-0.5 rounded-md text-[9px] font-black text-sky-400 border border-sky-500/20 whitespace-nowrap">
                <span className="opacity-50">$</span> {appState.rates.usd}
              </span>
              <span className="flex items-center gap-1.5 bg-emerald-500/10 px-2 py-0.5 rounded-md text-[9px] font-black text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
                <span className="opacity-50">€</span> {appState.rates.euro}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
             <div className="hidden sm:flex items-center gap-2 px-2 py-1 bg-white/5 rounded-md border border-white/5">
               <span className={`status-dot ${syncStatus === 'online' ? 'status-online' : 'status-syncing'}`}></span>
               <span className="text-[9px] font-black uppercase text-slate-500">{appState.cabinId}</span>
             </div>
            <select value={role} onChange={(e) => updateRole(e.target.value as DeviceRole)} className="bg-white/5 text-[9px] font-black uppercase py-1 px-2 rounded border border-white/10 outline-none cursor-pointer">
              <option value={DeviceRole.LAPTOP} className="bg-slate-900">💻 LAPTOP</option>
              <option value={DeviceRole.MOBILE} className="bg-slate-900">📱 MOBILE</option>
            </select>
          </div>
        </div>
      </header>

      {/* MAIN VIEWPORT: TWO HIGH-DENSITY TABLES */}
      <main className="flex-1 flex flex-col md:flex-row p-1 gap-1 overflow-hidden">
        
        {/* OUT PARTY: LEFT SIDE ON DESKTOP */}
        <section className={`flex-[2] glass-card rounded-lg overflow-hidden flex flex-col ${isLaptop ? 'master-glow' : ''}`}>
          <div className="px-3 py-1.5 bg-white/5 border-b border-white/5 flex justify-between items-center flex-shrink-0">
            <h2 className="text-[9px] font-black text-slate-500 uppercase tracking-widest">OUT PARTY</h2>
            <div className="flex gap-3">
               <span className="text-[9px] font-bold text-sky-400">CSH: {totals.opCash.toLocaleString()}</span>
               <span className="text-[9px] font-bold text-yellow-500">CRD: {totals.opCard.toLocaleString()}</span>
            </div>
          </div>
          
          <div className="table-container">
            <table className="w-full text-left text-[11px] border-collapse">
              <thead>
                <tr>
                  <th className="px-2 py-1.5 w-8 text-slate-500">#</th>
                  <th className="px-2 py-1.5 w-20">Type</th>
                  <th className="px-2 py-1.5">Amount (LKR)</th>
                  {isLaptop && <th className="px-2 py-1.5 w-8"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {appState.currentDay.outPartyEntries.map((e, i) => (
                  <tr key={e.id} className="hover:bg-white/[0.03] group">
                    <td className="px-2 py-0.5 text-slate-600 font-bold">{i + 1}</td>
                    <td className="px-2 py-0.5">
                      {isLaptop ? (
                        <select value={e.method} onChange={(ev) => updateOutParty(e.id, 'method', ev.target.value as PaymentMethod)} className="bg-transparent border-none text-[10px] font-bold text-sky-400 p-0 outline-none">
                          <option value={PaymentMethod.CASH} className="bg-slate-900 text-white">CASH</option>
                          <option value={PaymentMethod.CARD} className="bg-slate-900 text-white">CARD</option>
                          <option value={PaymentMethod.PAYPAL} className="bg-slate-900 text-white">PAYPAL</option>
                        </select>
                      ) : <span className="text-[9px] font-black opacity-30 uppercase">{e.method}</span>}
                    </td>
                    <td className="px-2 py-0.5">
                      {isLaptop ? (
                        <input type="number" value={e.amount || ''} onChange={(ev) => updateOutParty(e.id, 'amount', Number(ev.target.value))} className="compact-input font-black" placeholder="0" />
                      ) : <span className="font-black text-white">{e.amount.toLocaleString()}</span>}
                    </td>
                    {isLaptop && (
                      <td className="px-2 py-0.5 text-center">
                        <button onClick={() => deleteRecord(e.id, 'OP')} className="text-white/10 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* MAIN LEDGER: RIGHT SIDE ON DESKTOP */}
        <section className={`flex-[3] glass-card rounded-lg overflow-hidden flex flex-col ${isLaptop ? 'master-glow' : ''}`}>
          <div className="px-3 py-1.5 bg-white/5 border-b border-white/5 flex justify-between items-center flex-shrink-0">
            <h2 className="text-[9px] font-black text-slate-500 uppercase tracking-widest">CASH FLOW</h2>
            <div className="flex gap-3 text-[9px] font-bold">
              <span className="text-sky-400">IN: {totals.mainCashInTotal.toLocaleString()}</span>
              <span className="text-red-400">OUT: {totals.mainCashOutTotal.toLocaleString()}</span>
            </div>
          </div>
          
          <div className="table-container">
            <table className="w-full text-left text-[11px] border-collapse min-w-[500px] md:min-w-0">
              <thead>
                <tr>
                  <th className="px-2 py-1.5 w-12">RM</th>
                  <th className="px-2 py-1.5">Details</th>
                  <th className="px-2 py-1.5 w-20">Type</th>
                  <th className="px-2 py-1.5 w-24">Cash In</th>
                  <th className="px-2 py-1.5 w-24">Cash Out</th>
                  {isLaptop && <th className="px-2 py-1.5 w-8"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {appState.currentDay.mainEntries.map(e => (
                  <tr key={e.id} className="hover:bg-white/[0.03] group">
                    <td className="px-2 py-0.5">
                      {isLaptop ? (
                        <input value={e.roomNo} onChange={(ev) => updateMainEntry(e.id, 'roomNo', ev.target.value)} className="compact-input font-bold" placeholder="RM" />
                      ) : <span className="font-black opacity-60 text-[10px]">{e.roomNo}</span>}
                    </td>
                    <td className="px-2 py-0.5">
                      {isLaptop ? (
                        <input value={e.description} onChange={(ev) => updateMainEntry(e.id, 'description', ev.target.value)} className="compact-input text-slate-400" placeholder="..." />
                      ) : <span className="opacity-40 text-[10px]">{e.description}</span>}
                    </td>
                    <td className="px-2 py-0.5 text-center">
                       {isLaptop ? (
                        <select value={e.method} onChange={(ev) => updateMainEntry(e.id, 'method', ev.target.value as PaymentMethod)} className="bg-transparent border-none text-[9px] font-black text-slate-500 p-0 outline-none">
                          <option value={PaymentMethod.CASH} className="bg-slate-900 text-white">CSH</option>
                          <option value={PaymentMethod.CARD} className="bg-slate-900 text-white">CRD</option>
                          <option value={PaymentMethod.PAYPAL} className="bg-slate-900 text-white">PP</option>
                        </select>
                      ) : <span className="text-[9px] opacity-20">{e.method}</span>}
                    </td>
                    <td className="px-2 py-0.5">
                      {isLaptop ? (
                        <input type="number" value={e.cashIn || ''} onChange={(ev) => updateMainEntry(e.id, 'cashIn', Number(ev.target.value))} className="compact-input font-bold text-sky-400 text-right" placeholder="0" />
                      ) : <span className="text-sky-400 font-bold block text-right">{e.cashIn > 0 ? e.cashIn.toLocaleString() : '-'}</span>}
                    </td>
                    <td className="px-2 py-0.5">
                      {isLaptop ? (
                        <input type="number" value={e.cashOut || ''} onChange={(ev) => updateMainEntry(e.id, 'cashOut', Number(ev.target.value))} className="compact-input font-bold text-red-400 text-right" placeholder="0" />
                      ) : <span className="text-red-400 font-bold block text-right">{e.cashOut > 0 ? e.cashOut.toLocaleString() : '-'}</span>}
                    </td>
                    {isLaptop && (
                      <td className="px-2 py-0.5 text-center">
                        <button onClick={() => deleteRecord(e.id, 'MAIN')} className="text-white/10 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* FOOTER ACTION BAR: PINNED TO BOTTOM */}
      <footer className="glass-card border-x-0 border-b-0 p-3 flex-shrink-0 z-50">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-4">
          
          {/* BALANCE DISPLAY */}
          <div className="flex-grow flex items-center gap-6">
            <div className="flex flex-col">
              <span className="text-[8px] font-black text-sky-500 uppercase tracking-widest mb-1">TOTAL NET LIQUIDITY (LKR)</span>
              <span className="text-3xl md:text-4xl font-black text-white italic tracking-tighter tabular-nums leading-none">
                {totals.finalBalance.toLocaleString()}
              </span>
            </div>
          </div>

          {/* MASTER ACTION BUTTONS: FIXED TO BOTTOM */}
          <div className="flex items-center gap-2">
            {isLaptop && (
              <>
                <button onClick={addOutParty} className="bg-sky-500 text-black text-[10px] font-black px-4 py-2.5 rounded-lg hover:bg-sky-400 transition-all active:scale-95 shadow-lg shadow-sky-500/20 uppercase">
                  + OUT PARTY
                </button>
                <button onClick={addMainEntry} className="bg-emerald-500 text-black text-[10px] font-black px-4 py-2.5 rounded-lg hover:bg-emerald-400 transition-all active:scale-95 shadow-lg shadow-emerald-500/20 uppercase">
                  + FLOW ENTRY
                </button>
                <div className="h-8 w-px bg-white/10 mx-1"></div>
                <button onClick={handleDayEnd} className="bg-white text-black text-[10px] font-black px-6 py-2.5 rounded-lg hover:bg-slate-100 transition-all active:scale-95 shadow-xl uppercase italic">
                  CLOSE DAY
                </button>
              </>
            )}
            {!isLaptop && (
               <div className="bg-white/5 border border-white/10 text-white/50 text-[10px] font-black px-6 py-2.5 rounded-lg uppercase italic">
                  LIVE VIEWER MODE
               </div>
            )}
            
            <button 
               onClick={() => {
                 const s = appState.history.map(h => `${h.date}: Rs ${calculateTotals(h).finalBalance.toLocaleString()}`).join('\n');
                 alert(`ARCHIVE HISTORY:\n\n${s || 'No records yet.'}`);
               }}
               className="bg-white/5 border border-white/10 text-white text-[10px] font-black px-3 py-2.5 rounded-lg hover:bg-white/10 transition-all"
               title="History"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </button>
          </div>
        </div>
      </footer>

      {/* SYNC STATUS TOAST */}
      <div className="fixed bottom-2 right-2 pointer-events-none z-[100]">
        <div className="bg-black/80 backdrop-blur-md px-2 py-1 rounded-md border border-white/5 text-[8px] font-bold text-slate-500 uppercase flex items-center gap-2 pointer-events-auto">
           <div className={`w-1.5 h-1.5 rounded-full ${syncStatus === 'online' ? 'bg-emerald-500 shadow-[0_0_6px_#10b981]' : 'bg-red-500 animate-pulse'}`}></div>
           ID: <span className="text-white">{appState.cabinId}</span>
        </div>
      </div>
    </div>
  );
};

export default App;
