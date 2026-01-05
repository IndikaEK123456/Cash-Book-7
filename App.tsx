
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

  // 2. STABLE P2P SYNC ENGINE (KEEP UNCHANGED)
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
    if (!window.confirm("Delete?")) return;
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
        <div className="w-full max-w-md glass-card p-8 rounded-[2rem] text-center space-y-8">
          <h1 className="text-4xl font-black text-white italic uppercase tracking-tighter">SHIVAS</h1>
          <div className="space-y-4">
            <input 
              type="text" 
              placeholder="SYNC ID" 
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white font-bold text-center outline-none uppercase text-xl"
              onKeyDown={(e) => e.key === 'Enter' && pairDevice((e.target as HTMLInputElement).value)}
            />
            <button onClick={() => pairDevice((document.querySelector('input') as HTMLInputElement).value)} className="w-full bg-white text-black font-black py-4 rounded-xl transition-all active:scale-95 text-lg">START SYNC</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col font-medium h-screen overflow-hidden">
      {/* COMPACT HEADER */}
      <header className="glass-card border-x-0 border-t-0 py-3 px-4 flex-shrink-0">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-black tracking-tighter italic uppercase text-white">SHIVAS BEACH</h1>
            <div className="hidden sm:flex gap-2">
              <span className="bg-sky-500/10 px-3 py-1 rounded-lg text-[10px] font-bold text-sky-400 border border-sky-500/20">USD: {appState.rates.usd}</span>
              <span className="bg-emerald-500/10 px-3 py-1 rounded-lg text-[10px] font-bold text-emerald-400 border border-emerald-500/20">EURO: {appState.rates.euro}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-lg border border-white/10">
               <span className={`status-dot ${syncStatus === 'online' ? 'status-online' : 'status-syncing'}`}></span>
               <span className="text-[10px] font-black uppercase text-slate-400">{appState.cabinId}</span>
             </div>
            <select value={role} onChange={(e) => updateRole(e.target.value as DeviceRole)} className="bg-white/5 text-[10px] font-black uppercase py-1 px-2 rounded border border-white/10 outline-none">
              <option value={DeviceRole.LAPTOP} className="bg-slate-900">LAPTOP</option>
              <option value={DeviceRole.MOBILE} className="bg-slate-900">MOBILE</option>
            </select>
          </div>
        </div>
        {/* Mobile-only currency row */}
        <div className="flex sm:hidden gap-2 mt-2 justify-center">
            <span className="bg-sky-500/10 px-2 py-0.5 rounded text-[9px] font-black text-sky-400">USD {appState.rates.usd}</span>
            <span className="bg-emerald-500/10 px-2 py-0.5 rounded text-[9px] font-black text-emerald-400">EUR {appState.rates.euro}</span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-2 md:p-4 space-y-4 max-w-[1600px] mx-auto w-full">
        
        {/* OUT PARTY - HIGH DENSITY */}
        <section className={`glass-card rounded-2xl overflow-hidden flex flex-col ${isLaptop ? 'master-glow' : ''}`}>
          <div className="px-4 py-2 bg-white/5 border-b border-white/5 flex justify-between items-center">
            <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Out Party Terminal</h2>
            <div className="flex gap-4">
              <span className="text-[9px] font-bold text-sky-400">CASH: {totals.opCash.toLocaleString()}</span>
              <span className="text-[9px] font-bold text-yellow-500">CARD: {totals.opCard.toLocaleString()}</span>
            </div>
          </div>
          <div className="table-container">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="bg-slate-900/50">
                  <th className="px-4 py-2 w-10 text-slate-500">#</th>
                  <th className="px-4 py-2 w-32">Method</th>
                  <th className="px-4 py-2">Amount (LKR)</th>
                  {isLaptop && <th className="px-4 py-2 w-10"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {appState.currentDay.outPartyEntries.map((e, i) => (
                  <tr key={e.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-1 text-slate-600 font-bold">{i + 1}</td>
                    <td className="px-4 py-1">
                      {isLaptop ? (
                        <select value={e.method} onChange={(ev) => updateOutParty(e.id, 'method', ev.target.value as PaymentMethod)} className="bg-white/5 border border-white/10 rounded px-1 py-0.5 text-[10px] outline-none">
                          <option value={PaymentMethod.CASH} className="bg-slate-900">CASH</option>
                          <option value={PaymentMethod.CARD} className="bg-slate-900">CARD</option>
                          <option value={PaymentMethod.PAYPAL} className="bg-slate-900">PAYPAL</option>
                        </select>
                      ) : <span className="text-[9px] opacity-40 uppercase">{e.method}</span>}
                    </td>
                    <td className="px-4 py-1">
                      {isLaptop ? (
                        <input type="number" value={e.amount || ''} onChange={(ev) => updateOutParty(e.id, 'amount', Number(ev.target.value))} className="w-full bg-transparent font-black text-white outline-none focus:text-sky-400" />
                      ) : <span className="font-black">Rs {e.amount.toLocaleString()}</span>}
                    </td>
                    {isLaptop && (
                      <td className="px-4 py-1">
                        <button onClick={() => deleteRecord(e.id, 'OP')} className="text-white/10 hover:text-red-500 transition-colors"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {isLaptop && (
            <div className="p-2 border-t border-white/5 bg-slate-900/40">
              <button onClick={addOutParty} className="w-full bg-sky-500/20 hover:bg-sky-500/30 text-sky-400 text-[10px] font-black py-2 rounded-lg transition-all border border-sky-500/20">+ ADD OUT PARTY ENTRY</button>
            </div>
          )}
        </section>

        {/* MAIN LEDGER - HIGH DENSITY */}
        <section className={`glass-card rounded-2xl overflow-hidden flex flex-col ${isLaptop ? 'master-glow' : ''}`}>
          <div className="px-4 py-2 bg-white/5 border-b border-white/5 flex justify-between items-center">
            <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Master Ledger Flow</h2>
            <div className="flex gap-3 text-[9px] font-bold">
              <span className="text-sky-400">IN: {totals.mainCashInTotal.toLocaleString()}</span>
              <span className="text-red-400">OUT: {totals.mainCashOutTotal.toLocaleString()}</span>
            </div>
          </div>
          <div className="table-container">
            <table className="w-full text-left text-[11px] min-w-[700px] md:min-w-0">
              <thead>
                <tr className="bg-slate-900/50">
                  <th className="px-4 py-2 w-16">Room</th>
                  <th className="px-4 py-2">Details</th>
                  <th className="px-4 py-2 w-24">Type</th>
                  <th className="px-4 py-2 w-28">Cash In</th>
                  <th className="px-4 py-2 w-28">Cash Out</th>
                  {isLaptop && <th className="px-4 py-2 w-10"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {appState.currentDay.mainEntries.map(e => (
                  <tr key={e.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-1">
                      {isLaptop ? (
                        <input value={e.roomNo} onChange={(ev) => updateMainEntry(e.id, 'roomNo', ev.target.value)} className="w-full bg-white/5 border border-white/10 rounded px-1 py-0.5 text-[10px] outline-none" placeholder="RM" />
                      ) : <span className="font-bold opacity-70">{e.roomNo}</span>}
                    </td>
                    <td className="px-4 py-1">
                      {isLaptop ? (
                        <input value={e.description} onChange={(ev) => updateMainEntry(e.id, 'description', ev.target.value)} className="w-full bg-white/5 border border-white/10 rounded px-1 py-0.5 text-[10px] outline-none" placeholder="..." />
                      ) : <span className="opacity-50 text-[10px]">{e.description}</span>}
                    </td>
                    <td className="px-4 py-1">
                       {isLaptop ? (
                        <select value={e.method} onChange={(ev) => updateMainEntry(e.id, 'method', ev.target.value as PaymentMethod)} className="w-full bg-white/5 border border-white/10 rounded px-1 py-0.5 text-[10px] outline-none">
                          <option value={PaymentMethod.CASH} className="bg-slate-900">CASH</option>
                          <option value={PaymentMethod.CARD} className="bg-slate-900">CARD</option>
                          <option value={PaymentMethod.PAYPAL} className="bg-slate-900">PAYPAL</option>
                        </select>
                      ) : <span className="text-[9px] opacity-20">{e.method}</span>}
                    </td>
                    <td className="px-4 py-1">
                      {isLaptop ? (
                        <input type="number" value={e.cashIn || ''} onChange={(ev) => updateMainEntry(e.id, 'cashIn', Number(ev.target.value))} className="w-full bg-sky-500/5 text-sky-400 p-1 font-bold outline-none rounded" placeholder="0" />
                      ) : <span className="text-sky-400 font-bold">{e.cashIn > 0 ? e.cashIn.toLocaleString() : ''}</span>}
                    </td>
                    <td className="px-4 py-1">
                      {isLaptop ? (
                        <input type="number" value={e.cashOut || ''} onChange={(ev) => updateMainEntry(e.id, 'cashOut', Number(ev.target.value))} className="w-full bg-red-500/5 text-red-400 p-1 font-bold outline-none rounded" placeholder="0" />
                      ) : <span className="text-red-400 font-bold">{e.cashOut > 0 ? e.cashOut.toLocaleString() : ''}</span>}
                    </td>
                    {isLaptop && (
                      <td className="px-4 py-1">
                        <button onClick={() => deleteRecord(e.id, 'MAIN')} className="text-white/10 hover:text-red-500 transition-colors"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {isLaptop && (
            <div className="p-2 border-t border-white/5 bg-slate-900/40">
              <button onClick={addMainEntry} className="w-full bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-[10px] font-black py-2 rounded-lg transition-all border border-emerald-500/20">+ ADD FLOW ENTRY</button>
            </div>
          )}
        </section>

        {/* BOTTOM SUMMARY - FIXED HEIGHT */}
        <section className="relative flex-shrink-0">
          <div className="glass-card bg-slate-900/90 rounded-2xl p-4 md:p-6 border border-white/10 overflow-hidden">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="text-center md:text-left">
                <p className="text-[9px] font-black text-sky-500 uppercase tracking-widest">Net Wallet Liquidity</p>
                <p className="text-4xl md:text-6xl font-black text-white italic tabular-nums">Rs {totals.finalBalance.toLocaleString()}</p>
              </div>
              <div className="flex gap-2">
                <button 
                   onClick={() => {
                     const s = appState.history.map(h => `${h.date}: Rs ${calculateTotals(h).finalBalance.toLocaleString()}`).join('\n');
                     alert(`ARCHIVE:\n\n${s || 'Empty'}`);
                   }}
                   className="bg-white/5 border border-white/10 text-white text-[10px] font-black px-4 py-3 rounded-xl hover:bg-white/10 uppercase"
                >History</button>
                {isLaptop && (
                  <button onClick={handleDayEnd} className="bg-white text-black text-[10px] font-black px-8 py-3 rounded-xl shadow-xl active:scale-95 uppercase italic">Day Close</button>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <div className="fixed bottom-4 left-4 z-50 flex gap-2">
         <div className="bg-black/60 backdrop-blur-lg px-3 py-1.5 rounded-full border border-white/5 text-[8px] font-bold text-slate-500 uppercase flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${syncStatus === 'online' ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-red-500'}`}></div>
            ID: <span className="text-white">{appState.cabinId}</span>
         </div>
      </div>
    </div>
  );
};

export default App;
