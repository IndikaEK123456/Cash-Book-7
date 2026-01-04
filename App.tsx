
import React, { useState, useEffect, useMemo, useCallback } from 'react';
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

const createDefaultDay = (openingBalance: number = 0): DailyData => ({
  date: new Date().toLocaleDateString('en-GB'),
  outPartyEntries: [],
  mainEntries: [],
  openingBalance
});

const App: React.FC = () => {
  const [isInitializing, setIsInitializing] = useState(true);
  const [role, setRole] = useState<DeviceRole>(DeviceRole.MOBILE);
  const [appState, setAppState] = useState<AppState>({
    currentDay: createDefaultDay(),
    history: [],
    cabinId: '',
    rates: { usd: DEFAULT_LKR_USD, euro: DEFAULT_LKR_EURO },
    isPaired: false
  });

  // 1. BOOTSTRAP & SAFETY
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
      console.error("Critical Boot Failure", e);
    } finally {
      setIsInitializing(false);
    }
  }, []);

  // 2. LIVE SYNC ENGINE
  useEffect(() => {
    if (!appState.isPaired) return;

    const channel = new BroadcastChannel(`shivas_sync_${appState.cabinId}`);
    channel.onmessage = (e) => {
      if (e.data && e.data.type === 'UPDATE' && e.data.cabinId === appState.cabinId) {
        // Only update if incoming state is different to avoid loops
        if (JSON.stringify(e.data.state) !== JSON.stringify(appState)) {
          setAppState(prev => ({ ...prev, ...e.data.state }));
        }
      }
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    channel.postMessage({ type: 'UPDATE', state: appState, cabinId: appState.cabinId });

    return () => channel.close();
  }, [appState]);

  // 3. CURRENCY UPDATE
  useEffect(() => {
    const syncRates = async () => {
      const freshRates = await fetchLiveExchangeRates();
      setAppState(prev => ({ ...prev, rates: freshRates }));
    };
    syncRates();
  }, []);

  const isLaptop = role === DeviceRole.LAPTOP;
  const totals = useMemo(() => calculateTotals(appState.currentDay), [appState.currentDay]);

  // 4. HANDLERS
  const updateRole = (newRole: DeviceRole) => {
    setRole(newRole);
    localStorage.setItem('shivas_role', newRole);
  };

  const pairDevice = useCallback((id: string) => {
    const cleanId = id.trim().toUpperCase();
    if (!cleanId) return;
    setAppState(prev => ({ ...prev, cabinId: cleanId, isPaired: true }));
  }, []);

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

  // REFINED DELETE FUNCTION (Both sections supported)
  const deleteRecord = (id: string, section: 'OP' | 'MAIN') => {
    if (!isLaptop) return;
    if (!window.confirm("Permanent Delete? This action cannot be undone.")) return;
    
    setAppState(prev => {
      const nextDay = { ...prev.currentDay };
      if (section === 'OP') {
        nextDay.outPartyEntries = nextDay.outPartyEntries.filter(e => e.id !== id);
      } else {
        nextDay.mainEntries = nextDay.mainEntries.filter(e => e.id !== id);
      }
      return { ...prev, currentDay: nextDay };
    });
  };

  const handleDayEnd = () => {
    if (!isLaptop || !window.confirm("Confirm Day End? This will archive today and start a new book.")) return;
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
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#0f172a]">
        <div className="w-full max-w-md glass-card p-10 rounded-[2.5rem] shadow-2xl text-center space-y-8">
          <div>
            <h1 className="text-4xl font-[800] tracking-tighter text-white mb-2 italic uppercase">Shivas Beach</h1>
            <p className="text-sky-400 text-[10px] font-black uppercase tracking-[0.4em]">Live Connection Terminal</p>
          </div>
          <div className="space-y-4">
            <input 
              type="text" 
              placeholder="ASSIGN CABIN ID" 
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-5 text-white font-bold text-center focus:ring-4 ring-sky-500/20 outline-none uppercase text-xl transition-all"
              onKeyDown={(e) => e.key === 'Enter' && pairDevice((e.target as HTMLInputElement).value)}
            />
            <button 
              onClick={() => pairDevice((document.querySelector('input') as HTMLInputElement).value)}
              className="w-full bg-sky-500 hover:bg-sky-400 text-slate-900 font-extrabold py-5 rounded-2xl transition-all active:scale-95 text-lg shadow-xl shadow-sky-500/20"
            >
              INITIALIZE LIVE LINK
            </button>
          </div>
          <p className="text-slate-500 text-[10px] font-bold px-4 leading-relaxed uppercase">
            Sync Laptop & Mobile by using the same ID.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 flex flex-col">
      <header className="sticky top-0 z-[100] glass-card border-x-0 border-t-0 py-4 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex flex-col">
            <h1 className="text-xl md:text-2xl font-[900] tracking-tighter italic uppercase text-white">Shivas Beach Cabanas</h1>
            <div className="flex gap-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <span className="text-sky-400">{appState.currentDay.date}</span>
              <span className="hidden md:block">USD: <span className="text-white">{appState.rates.usd}</span></span>
              <span className="hidden md:block">EURO: <span className="text-white">{appState.rates.euro}</span></span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 bg-sky-500/10 px-4 py-2 rounded-xl border border-sky-500/20">
               <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse"></div>
               <span className="text-[10px] font-black text-sky-400 uppercase tracking-widest">Live ID: {appState.cabinId}</span>
            </div>
            <select 
              value={role} 
              onChange={(e) => updateRole(e.target.value as DeviceRole)}
              className="bg-white/5 text-white text-[10px] font-black uppercase py-2.5 px-4 rounded-xl border border-white/10 outline-none cursor-pointer hover:bg-white/10"
            >
              <option value={DeviceRole.LAPTOP} className="bg-slate-900">💻 Laptop (Master)</option>
              <option value={DeviceRole.MOBILE} className="bg-slate-900">📱 Mobile (Viewer)</option>
            </select>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-8 space-y-12">
        
        {/* OUT PARTY */}
        <section className="glass-card rounded-[2.5rem] overflow-hidden">
          <div className="px-8 py-5 border-b border-white/5 flex justify-between items-center bg-white/5">
            <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Out Party Terminal</h2>
            {isLaptop && (
              <button onClick={addOutParty} className="bg-sky-500 hover:bg-sky-400 text-slate-900 text-[10px] font-black px-5 py-2 rounded-xl shadow-lg transition-all">+ NEW ENTRY</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-black text-slate-500 uppercase tracking-widest bg-white/[0.02]">
                  <th className="px-8 py-4 w-16">#</th>
                  <th className="px-8 py-4">Method</th>
                  <th className="px-8 py-4">Amount (LKR)</th>
                  {isLaptop && <th className="px-8 py-4 w-20 text-center">Del</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {appState.currentDay.outPartyEntries.map((e, i) => (
                  <tr key={e.id} className="group hover:bg-white/[0.03] transition-colors">
                    <td className="px-8 py-5 font-black text-slate-500">{i + 1}</td>
                    <td className="px-8 py-5">
                      {isLaptop ? (
                        <select 
                          value={e.method} 
                          onChange={(ev) => updateOutParty(e.id, 'method', ev.target.value as PaymentMethod)}
                          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs font-bold text-white outline-none"
                        >
                          <option value={PaymentMethod.CASH} className="bg-slate-900">CASH</option>
                          <option value={PaymentMethod.CARD} className="bg-slate-900">CARD</option>
                          <option value={PaymentMethod.PAYPAL} className="bg-slate-900">PAYPAL</option>
                        </select>
                      ) : <span className="text-xs font-black uppercase text-slate-300">{e.method}</span>}
                    </td>
                    <td className="px-8 py-5">
                      {isLaptop ? (
                        <input 
                          type="number" 
                          value={e.amount || ''} 
                          onChange={(ev) => updateOutParty(e.id, 'amount', Number(ev.target.value))}
                          className="w-full max-w-[240px] bg-transparent border-b border-white/10 text-2xl font-[900] text-white outline-none focus:border-sky-500 py-1"
                        />
                      ) : <span className="text-2xl font-[900] text-white">Rs {e.amount.toLocaleString()}</span>}
                    </td>
                    {isLaptop && (
                      <td className="px-8 py-5 text-center">
                        <button 
                          onClick={() => deleteRecord(e.id, 'OP')} 
                          className="delete-btn-hover text-white/20 p-2.5 rounded-full transition-all"
                          title="Delete Out Party Entry"
                        >
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 bg-white/[0.03] border-t border-white/5">
             <div className="p-8 border-r border-white/5 text-center">
                <p className="text-[10px] font-black text-sky-400 uppercase tracking-widest mb-1">OP Cash</p>
                <p className="text-3xl font-[900]">Rs {totals.opCash.toLocaleString()}</p>
             </div>
             <div className="p-8 border-r border-white/5 text-center">
                <p className="text-[10px] font-black text-yellow-500 uppercase tracking-widest mb-1">OP Card</p>
                <p className="text-3xl font-[900] text-yellow-500">Rs {totals.opCard.toLocaleString()}</p>
             </div>
             <div className="p-8 text-center">
                <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest mb-1">OP PayPal</p>
                <p className="text-3xl font-[900] text-purple-400">Rs {totals.opPaypal.toLocaleString()}</p>
             </div>
          </div>
        </section>

        {/* MAIN SECTION */}
        <section className="glass-card rounded-[2.5rem] overflow-hidden">
          <div className="px-8 py-5 border-b border-white/5 flex justify-between items-center bg-white/5">
            <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Master Cash Flow</h2>
            {isLaptop && (
              <button onClick={addMainEntry} className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 text-[10px] font-black px-5 py-2 rounded-xl shadow-lg transition-all">+ NEW FLOW</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[1000px]">
              <thead>
                <tr className="text-[10px] font-black text-slate-500 uppercase tracking-widest bg-white/[0.02]">
                  <th className="px-8 py-4 w-24">Room</th>
                  <th className="px-8 py-4">Descriptions</th>
                  <th className="px-8 py-4 w-32">Type</th>
                  <th className="px-8 py-4 w-44">Cash In</th>
                  <th className="px-8 py-4 w-44">Cash Out</th>
                  {isLaptop && <th className="px-8 py-4 w-20 text-center">Del</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {appState.currentDay.mainEntries.map(e => (
                  <tr key={e.id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="px-8 py-5">
                      {isLaptop ? (
                        <input value={e.roomNo} onChange={(ev) => updateMainEntry(e.id, 'roomNo', ev.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-xs font-bold text-white outline-none" placeholder="RM#"/>
                      ) : <span className="font-black text-white">{e.roomNo}</span>}
                    </td>
                    <td className="px-8 py-5">
                      {isLaptop ? (
                        <input value={e.description} onChange={(ev) => updateMainEntry(e.id, 'description', ev.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-xs font-bold text-white outline-none" placeholder="Source/Purpose..."/>
                      ) : <span className="text-sm font-bold text-slate-300">{e.description}</span>}
                    </td>
                    <td className="px-8 py-5">
                       {isLaptop ? (
                        <select value={e.method} onChange={(ev) => updateMainEntry(e.id, 'method', ev.target.value as PaymentMethod)} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs font-bold text-white outline-none">
                          <option value={PaymentMethod.CASH} className="bg-slate-900">CASH</option>
                          <option value={PaymentMethod.CARD} className="bg-slate-900">CARD</option>
                          <option value={PaymentMethod.PAYPAL} className="bg-slate-900">PAYPAL</option>
                        </select>
                      ) : <span className="text-[10px] font-black opacity-30">{e.method}</span>}
                    </td>
                    <td className="px-8 py-5">
                      {isLaptop ? (
                        <input type="number" value={e.cashIn || ''} onChange={(ev) => updateMainEntry(e.id, 'cashIn', Number(ev.target.value))} className="w-full bg-sky-500/5 text-sky-400 border border-sky-500/20 rounded-lg p-2.5 text-lg font-[900] outline-none" placeholder="0"/>
                      ) : <span className="text-xl font-[900] text-sky-400">{e.cashIn > 0 ? `Rs ${e.cashIn.toLocaleString()}` : ''}</span>}
                    </td>
                    <td className="px-8 py-5">
                      {isLaptop ? (
                        <input type="number" value={e.cashOut || ''} onChange={(ev) => updateMainEntry(e.id, 'cashOut', Number(ev.target.value))} className="w-full bg-red-500/5 text-red-400 border border-red-500/20 rounded-lg p-2.5 text-lg font-[900] outline-none" placeholder="0"/>
                      ) : <span className="text-xl font-[900] text-red-400">{e.cashOut > 0 ? `Rs ${e.cashOut.toLocaleString()}` : ''}</span>}
                    </td>
                    {isLaptop && (
                      <td className="px-8 py-5 text-center">
                        <button 
                          onClick={() => deleteRecord(e.id, 'MAIN')} 
                          className="delete-btn-hover text-white/20 p-2.5 rounded-full transition-all"
                          title="Delete Main Entry"
                        >
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 p-8 gap-8 bg-black/20 border-t border-white/5">
             <div className="space-y-1 text-center">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Total Card</p>
                <p className="text-xl font-[900] text-white">Rs {totals.mainCardTotal.toLocaleString()}</p>
             </div>
             <div className="space-y-1 text-center">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Total PayPal</p>
                <p className="text-xl font-[900] text-white">Rs {totals.mainPaypalTotal.toLocaleString()}</p>
             </div>
             <div className="space-y-1 text-center bg-sky-500/10 py-4 rounded-3xl border border-sky-500/20">
                <p className="text-[9px] font-black text-sky-500 uppercase tracking-[0.2em]">Cash In Sum</p>
                <p className="text-2xl font-[1000] text-sky-400">Rs {totals.mainCashInTotal.toLocaleString()}</p>
             </div>
             <div className="space-y-1 text-center bg-red-500/10 py-4 rounded-3xl border border-red-500/20">
                <p className="text-[9px] font-black text-red-500 uppercase tracking-[0.2em]">Cash Out Sum</p>
                <p className="text-2xl font-[1000] text-red-400">Rs {totals.mainCashOutTotal.toLocaleString()}</p>
             </div>
          </div>
        </section>

        {/* FINAL BALANCE CARD */}
        <section className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-sky-500 to-indigo-600 rounded-[4rem] blur opacity-10 group-hover:opacity-25 transition-all"></div>
          <div className="relative glass-card bg-slate-900/80 rounded-[4rem] p-12 md:p-24 flex flex-col md:flex-row items-center justify-between gap-12 border-2 border-white/5 overflow-hidden">
            <div className="absolute top-0 right-0 w-96 h-96 bg-sky-500/5 blur-[120px] rounded-full pointer-events-none"></div>
            <div className="text-center md:text-left">
              <h3 className="text-[11px] font-[900] text-sky-500 uppercase tracking-[0.8em] mb-10">Net Wallet Balance</h3>
              <div className="text-7xl md:text-[10rem] font-[1000] text-white tracking-tighter leading-none drop-shadow-2xl italic tabular-nums">
                Rs {totals.finalBalance.toLocaleString()}
              </div>
            </div>
            {isLaptop && (
              <button 
                onClick={handleDayEnd}
                className="bg-white text-slate-950 px-20 py-10 rounded-[2.5rem] font-[900] text-3xl shadow-2xl hover:scale-105 active:scale-95 transition-all uppercase tracking-tighter"
              >
                Day Close
              </button>
            )}
          </div>
        </section>
      </main>

      <div className="fixed bottom-8 left-8 z-50">
        <div className="glass-card px-6 py-4 rounded-3xl shadow-2xl flex items-center gap-4 bg-slate-900/90 border-white/10">
           <div className="w-2.5 h-2.5 bg-sky-500 rounded-full animate-pulse shadow-lg shadow-sky-500/50"></div>
           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Global Link: <span className="text-white">{appState.cabinId}</span></span>
        </div>
      </div>

      <button 
        onClick={() => {
          if (appState.history.length === 0) return alert("Archive is empty.");
          const summary = appState.history.map(h => `${h.date}: Rs ${calculateTotals(h).finalBalance.toLocaleString()}`).join('\n');
          alert(`BOOK ARCHIVE:\n\n${summary}`);
        }}
        className="fixed bottom-8 right-8 glass-card bg-white/5 text-white px-8 py-5 rounded-full font-black text-[10px] uppercase shadow-2xl hover:bg-white/10 transition-all active:scale-95 flex items-center gap-3 border-white/10 tracking-widest"
      >
        <svg className="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        History ({appState.history.length})
      </button>
    </div>
  );
};

export default App;
