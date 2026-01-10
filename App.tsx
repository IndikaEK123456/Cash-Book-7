
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
  const [viewHistory, setViewHistory] = useState<boolean>(false);
  const [selectedHistoryDay, setSelectedHistoryDay] = useState<DailyData | null>(null);

  const peerRef = useRef<any>(null);
  const connectionsRef = useRef<any[]>([]);
  const stateRef = useRef(appState);
  const reconnectTimeoutRef = useRef<number | null>(null);

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

  const getMethodColor = (method: PaymentMethod) => {
    switch(method) {
      case PaymentMethod.CARD: return 'text-yellow-400';
      case PaymentMethod.PAYPAL: return 'text-purple-400';
      default: return 'text-sky-400';
    }
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
      {/* HEADER: COMPACT WITH DUAL CURRENCY AND DATE */}
      <header className="glass-card border-x-0 border-t-0 py-2 px-4 flex-shrink-0 z-50">
        <div className="max-w-full mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <h1 className="text-sm md:text-base font-[900] tracking-tighter italic uppercase text-white whitespace-nowrap leading-none">SHIVAS BEACH</h1>
              <span className="text-[8px] font-black text-sky-400 mt-1 uppercase tracking-widest">{appState.currentDay.date}</span>
            </div>
            <div className="h-6 w-px bg-white/10 mx-1 hidden sm:block"></div>
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
             <div className="hidden lg:flex items-center gap-2 px-2 py-1 bg-white/5 rounded-md border border-white/5">
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
            <div className="flex gap-2">
               <span className="text-[9px] font-bold text-sky-400 border border-white/5 px-1.5 py-0.5 rounded">CSH: {totals.opCash.toLocaleString()}</span>
               <span className="text-[9px] font-bold text-yellow-400 border border-white/5 px-1.5 py-0.5 rounded">CRD: {totals.opCard.toLocaleString()}</span>
               <span className="text-[9px] font-bold text-purple-400 border border-white/5 px-1.5 py-0.5 rounded">PP: {totals.opPaypal.toLocaleString()}</span>
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
                        <select value={e.method} onChange={(ev) => updateOutParty(e.id, 'method', ev.target.value as PaymentMethod)} className={`bg-transparent border-none text-[10px] font-bold ${getMethodColor(e.method)} p-0 outline-none`}>
                          <option value={PaymentMethod.CASH} className="bg-slate-900 text-white">CASH</option>
                          <option value={PaymentMethod.CARD} className="bg-slate-900 text-white">CARD</option>
                          <option value={PaymentMethod.PAYPAL} className="bg-slate-900 text-white">PAYPAL</option>
                        </select>
                      ) : <span className={`text-[9px] font-black opacity-60 uppercase ${getMethodColor(e.method)}`}>{e.method}</span>}
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
            <div className="flex gap-2 text-[9px] font-bold">
              <span className="text-sky-400 border border-white/5 px-1.5 py-0.5 rounded">IN: {totals.mainCashInTotal.toLocaleString()}</span>
              <span className="text-red-400 border border-white/5 px-1.5 py-0.5 rounded">OUT: {totals.mainCashOutTotal.toLocaleString()}</span>
              <div className="w-px bg-white/10 mx-0.5"></div>
              <span className="text-yellow-400 border border-yellow-400/20 px-1.5 py-0.5 rounded bg-yellow-400/5">CRD: {totals.mainCardOnly.toLocaleString()}</span>
              <span className="text-purple-400 border border-purple-400/20 px-1.5 py-0.5 rounded bg-purple-400/5">PP: {totals.mainPaypalOnly.toLocaleString()}</span>
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
                        <select value={e.method} onChange={(ev) => updateMainEntry(e.id, 'method', ev.target.value as PaymentMethod)} className={`bg-transparent border-none text-[9px] font-black ${getMethodColor(e.method)} p-0 outline-none`}>
                          <option value={PaymentMethod.CASH} className="bg-slate-900 text-white">CSH</option>
                          <option value={PaymentMethod.CARD} className="bg-slate-900 text-white">CRD</option>
                          <option value={PaymentMethod.PAYPAL} className="bg-slate-900 text-white">PP</option>
                        </select>
                      ) : <span className={`text-[9px] font-black opacity-60 ${getMethodColor(e.method)}`}>{e.method === PaymentMethod.CASH ? 'CSH' : e.method === PaymentMethod.CARD ? 'CRD' : 'PP'}</span>}
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
          
          {/* BALANCE DISPLAY & AGGREGATED TOTALS */}
          <div className="flex-grow flex flex-col md:flex-row items-center gap-6">
            <div className="flex flex-col">
              <span className="text-[8px] font-black text-sky-500 uppercase tracking-widest mb-1">TOTAL NET LIQUIDITY (LKR)</span>
              <span className="text-3xl md:text-4xl font-black text-white italic tracking-tighter tabular-nums leading-none">
                {totals.finalBalance.toLocaleString()}
              </span>
            </div>
            
            <div className="flex gap-4">
               <div className="flex flex-col border-l border-white/10 pl-4">
                  <span className="text-[7px] font-black text-yellow-400 uppercase mb-1">Aggregated Card</span>
                  <span className="text-sm font-black text-yellow-400/80">Rs {totals.mainCardTotal.toLocaleString()}</span>
                  <span className="text-[6px] opacity-30">({totals.opCard} OP + {totals.mainCardOnly} MAIN)</span>
               </div>
               <div className="flex flex-col border-l border-white/10 pl-4">
                  <span className="text-[7px] font-black text-purple-400 uppercase mb-1">Aggregated PayPal</span>
                  <span className="text-sm font-black text-purple-400/80">Rs {totals.mainPaypalTotal.toLocaleString()}</span>
                  <span className="text-[6px] opacity-30">({totals.opPaypal} OP + {totals.mainPaypalOnly} MAIN)</span>
               </div>
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
               onClick={() => setViewHistory(true)}
               className="bg-white/5 border border-white/10 text-white text-[10px] font-black px-3 py-2.5 rounded-lg hover:bg-white/10 transition-all"
               title="History"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </button>
          </div>
        </div>
      </footer>

      {/* HISTORY OVERLAY */}
      {viewHistory && (
        <div className="fixed inset-0 bg-[#020617]/95 backdrop-blur-xl z-[200] flex flex-col p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-4">
            <h2 className="text-2xl font-black italic uppercase tracking-tighter">Day End Archives</h2>
            <button onClick={() => { setViewHistory(false); setSelectedHistoryDay(null); }} className="bg-white/5 p-2 rounded-full hover:bg-red-500 transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          
          <div className="flex flex-col md:flex-row gap-4 flex-1 overflow-hidden">
            {/* List of Archived Days */}
            <div className="w-full md:w-64 overflow-y-auto pr-2 space-y-2 no-scrollbar">
              {appState.history.length === 0 ? (
                <p className="text-slate-500 text-xs text-center py-10 italic">No historical records found.</p>
              ) : (
                appState.history.map((h, i) => (
                  <button 
                    key={i} 
                    onClick={() => setSelectedHistoryDay(h)}
                    className={`w-full text-left p-4 rounded-xl transition-all border ${selectedHistoryDay?.date === h.date ? 'bg-sky-500 border-sky-400 text-black' : 'bg-white/5 border-white/10 text-white hover:bg-white/10'}`}
                  >
                    <p className="text-[10px] font-black uppercase opacity-60">Archive Record</p>
                    <p className="text-lg font-black">{h.date}</p>
                    <p className={`text-[11px] font-bold ${selectedHistoryDay?.date === h.date ? 'text-black/60' : 'text-sky-400'}`}>Rs {calculateTotals(h).finalBalance.toLocaleString()}</p>
                  </button>
                ))
              )}
            </div>

            {/* Detailed Breakdown */}
            <div className="flex-1 glass-card rounded-2xl p-4 overflow-y-auto no-scrollbar border border-white/10">
              {selectedHistoryDay ? (
                <div className="space-y-6">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-white/5 pb-4">
                    <div>
                      <p className="text-[10px] font-black text-sky-500 uppercase tracking-widest">Detail Report for</p>
                      <h3 className="text-4xl font-black italic tracking-tighter leading-none">{selectedHistoryDay.date}</h3>
                    </div>
                    <div className="mt-4 md:mt-0 text-right">
                       <p className="text-[8px] font-black text-slate-500 uppercase">Closing Net Liquidity</p>
                       <p className="text-3xl font-black text-white italic">Rs {calculateTotals(selectedHistoryDay).finalBalance.toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-white/5 pb-1">Out Party Breakdown</h4>
                      <div className="space-y-1">
                        {selectedHistoryDay.outPartyEntries.map((e, idx) => (
                          <div key={idx} className="flex justify-between items-center bg-white/5 p-2 rounded text-xs">
                             <span className={`font-black uppercase text-[9px] ${getMethodColor(e.method)}`}>{e.method}</span>
                             <span className="font-bold">Rs {e.amount.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-white/5 pb-1">Cash Flow Breakdown</h4>
                      <div className="space-y-1">
                        {selectedHistoryDay.mainEntries.map((e, idx) => (
                          <div key={idx} className="flex flex-col bg-white/5 p-2 rounded text-xs">
                             <div className="flex justify-between mb-1">
                                <span className="font-black text-[10px] uppercase opacity-40">RM {e.roomNo}</span>
                                <span className={`font-black uppercase text-[8px] opacity-60 ${getMethodColor(e.method)}`}>{e.method}</span>
                             </div>
                             <div className="flex justify-between">
                                <span className="opacity-50">{e.description}</span>
                                <div className="flex gap-4">
                                   {e.cashIn > 0 && <span className="text-sky-400 font-bold">+{e.cashIn.toLocaleString()}</span>}
                                   {e.cashOut > 0 && <span className="text-red-400 font-bold">-{e.cashOut.toLocaleString()}</span>}
                                </div>
                             </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="bg-sky-500/5 border border-sky-500/20 p-4 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-[8px] font-black opacity-40 uppercase">Card Aggregated</p>
                      <p className="text-lg font-black text-yellow-400">Rs {calculateTotals(selectedHistoryDay).mainCardTotal.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[8px] font-black opacity-40 uppercase">PayPal Aggregated</p>
                      <p className="text-lg font-black text-purple-400">Rs {calculateTotals(selectedHistoryDay).mainPaypalTotal.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[8px] font-black opacity-40 uppercase">Total Cash In</p>
                      <p className="text-lg font-black text-sky-400">Rs {calculateTotals(selectedHistoryDay).mainCashInTotal.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[8px] font-black opacity-40 uppercase">Total Cash Out</p>
                      <p className="text-lg font-black text-red-400">Rs {calculateTotals(selectedHistoryDay).mainCashOutTotal.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-10 opacity-20">
                   <svg className="w-20 h-20 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                   <p className="text-xl font-black italic uppercase italic">Select an archive to view full details</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
