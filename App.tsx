
import React, { useState, useEffect, useMemo } from 'react';
import { 
  DeviceRole, 
  PaymentMethod, 
  AppState, 
  OutPartyEntry, 
  MainEntry 
} from './types';
import { STORAGE_KEY, DEFAULT_LKR_USD, DEFAULT_LKR_EURO } from './constants';
import { calculateTotals } from './utils/calculations';
import { fetchLiveExchangeRates } from './services/geminiService';

const App: React.FC = () => {
  // 1. SAFE INITIALIZATION (Prevents Vercel Blank Page)
  const [role, setRole] = useState<DeviceRole>(() => {
    try {
      const saved = localStorage.getItem('shivas_device_mode');
      if (saved) return saved as DeviceRole;
      return window.innerWidth < 1024 ? DeviceRole.MOBILE : DeviceRole.LAPTOP;
    } catch (e) {
      return DeviceRole.LAPTOP;
    }
  });

  const [appState, setAppState] = useState<AppState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Ensure rates exist
        if (!parsed.rates) parsed.rates = { usd: DEFAULT_LKR_USD, euro: DEFAULT_LKR_EURO };
        return parsed;
      }
    } catch (e) {}
    
    return {
      currentDay: {
        date: new Date().toLocaleDateString('en-GB'),
        outPartyEntries: [],
        mainEntries: [],
        openingBalance: 0,
      },
      history: [],
      cabinId: '',
      rates: { usd: DEFAULT_LKR_USD, euro: DEFAULT_LKR_EURO },
      isPaired: false
    };
  });

  // 2. RECONNECT & SYNC LOGIC (Rule 3, 4)
  useEffect(() => {
    // Cross-tab sync via storage event
    const handleSync = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        const newState = JSON.parse(e.newValue);
        if (newState.cabinId === appState.cabinId) {
          setAppState(newState);
        }
      }
    };
    window.addEventListener('storage', handleSync);

    // Cross-device "Cloud" Relay emulation via BroadcastChannel
    const channel = new BroadcastChannel('shivas_cloud_relay');
    channel.onmessage = (e) => {
      if (e.data.cabinId === appState.cabinId && e.data.state) {
        setAppState(e.data.state);
      }
    };

    return () => {
      window.removeEventListener('storage', handleSync);
      channel.close();
    };
  }, [appState.cabinId]);

  // Persist and broadcast
  useEffect(() => {
    if (appState.isPaired) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
      const channel = new BroadcastChannel('shivas_cloud_relay');
      channel.postMessage({ cabinId: appState.cabinId, state: appState });
    }
  }, [appState]);

  // Fetch Live Rates (Rule 12)
  useEffect(() => {
    const updateRates = async () => {
      const rates = await fetchLiveExchangeRates();
      setAppState(prev => ({ ...prev, rates }));
    };
    updateRates();
    const interval = setInterval(updateRates, 1000 * 60 * 30); // 30 min refresh
    return () => clearInterval(interval);
  }, []);

  // 3. LOGIC & PERMISSIONS (Rule 2)
  const isLaptop = role === DeviceRole.LAPTOP;
  const totals = useMemo(() => calculateTotals(appState.currentDay), [appState.currentDay]);

  const pairDevice = (id: string) => {
    const cleanId = id.trim().toUpperCase();
    if (!cleanId) return;
    setAppState(prev => ({ ...prev, cabinId: cleanId, isPaired: true }));
  };

  const switchMode = (newMode: DeviceRole) => {
    setRole(newMode);
    localStorage.setItem('shivas_device_mode', newMode);
  };

  // 4. CRUD OPERATIONS (Laptop Only)
  const addOutParty = () => {
    if (!isLaptop) return;
    const newEntry: OutPartyEntry = {
      id: crypto.randomUUID(),
      index: appState.currentDay.outPartyEntries.length + 1,
      method: PaymentMethod.CASH,
      amount: 0
    };
    setAppState(prev => ({
      ...prev,
      currentDay: { ...prev.currentDay, outPartyEntries: [...prev.currentDay.outPartyEntries, newEntry] }
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
    const newEntry: MainEntry = {
      id: crypto.randomUUID(),
      roomNo: '',
      description: '',
      method: PaymentMethod.CASH,
      cashIn: 0,
      cashOut: 0
    };
    setAppState(prev => ({
      ...prev,
      currentDay: { ...prev.currentDay, mainEntries: [...prev.currentDay.mainEntries, newEntry] }
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

  const deleteEntry = (id: string, section: 'OP' | 'MAIN') => {
    if (!isLaptop) return;
    if (!window.confirm("Are you sure you want to delete this entry?")) return;
    setAppState(prev => ({
      ...prev,
      currentDay: {
        ...prev.currentDay,
        outPartyEntries: section === 'OP' ? prev.currentDay.outPartyEntries.filter(e => e.id !== id) : prev.currentDay.outPartyEntries,
        mainEntries: section === 'MAIN' ? prev.currentDay.mainEntries.filter(e => e.id !== id) : prev.currentDay.mainEntries,
      }
    }));
  };

  const handleDayEnd = () => {
    if (!isLaptop) return;
    if (!window.confirm("Perform Day End? Today's data will be saved to archive and cleared for a new day.")) return;
    setAppState(prev => ({
      ...prev,
      history: [...prev.history, prev.currentDay],
      currentDay: {
        date: new Date().toLocaleDateString('en-GB'),
        outPartyEntries: [],
        mainEntries: [],
        openingBalance: totals.finalBalance
      }
    }));
  };

  // 5. RENDER HELPERS
  const formatLKR = (val: number) => {
    if (val === 0) return '';
    return `Rs ${val.toLocaleString()}`;
  };

  // --- PAIRING SCREEN (Rule 3) ---
  if (!appState.isPaired) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="bg-slate-900 border border-slate-800 p-10 rounded-[3rem] shadow-2xl max-w-sm w-full text-center">
          <h1 className="text-4xl font-black text-sky-400 mb-2 tracking-tighter">SHIVAS BEACH</h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.3em] mb-10">Advanced Cloud Cash Book</p>
          <input 
            type="text" 
            placeholder="ENTER CABIN ID" 
            className="w-full bg-slate-800 border-2 border-slate-700 rounded-2xl px-6 py-5 text-white font-black text-center mb-6 focus:border-sky-500 outline-none uppercase text-xl"
            onKeyDown={(e) => e.key === 'Enter' && pairDevice((e.target as HTMLInputElement).value)}
          />
          <button 
            onClick={() => pairDevice((document.querySelector('input') as HTMLInputElement).value)}
            className="w-full bg-sky-500 hover:bg-sky-400 text-slate-950 font-black py-5 rounded-2xl transition-all shadow-lg active:scale-95"
          >
            CONNECT DEVICES
          </button>
        </div>
      </div>
    );
  }

  // --- MAIN DASHBOARD (Rule 20) ---
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 font-bold selection:bg-sky-200">
      {/* HEADER (Rule 9, 12) */}
      <header className="bg-slate-950 text-white p-5 sticky top-0 z-50 shadow-2xl border-b border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-center md:text-left">
            <h1 className="text-2xl md:text-3xl font-black tracking-tighter text-sky-400">SHIVAS BEACH CABANAS</h1>
            <div className="flex flex-wrap justify-center md:justify-start gap-4 text-[11px] font-black uppercase opacity-80 mt-1">
              <span className="bg-slate-800 px-2 py-0.5 rounded text-white">{appState.currentDay.date}</span>
              <span className="text-sky-300">USD {appState.rates.usd} LKR</span>
              <span className="text-indigo-300">EURO {appState.rates.euro} LKR</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-emerald-500/10 text-emerald-400 px-4 py-2 rounded-xl text-xs font-black border border-emerald-500/30 flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
              ID: {appState.cabinId}
            </div>
            <select 
              value={role} 
              onChange={(e) => switchMode(e.target.value as DeviceRole)}
              className="bg-slate-800 text-white px-3 py-2 rounded-xl text-xs font-black uppercase outline-none focus:ring-2 ring-sky-500"
            >
              <option value={DeviceRole.LAPTOP}>💻 LAPTOP (EDITOR)</option>
              <option value={DeviceRole.MOBILE}>📱 MOBILE (VIEWER)</option>
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-12">
        
        {/* SECTION 1: OUT PARTY (Rule 5, 6, 8) */}
        <section className="bg-white rounded-[2.5rem] shadow-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-8 py-5 flex justify-between items-center border-b border-slate-200">
            <h2 className="text-sm font-black text-slate-400 uppercase tracking-[0.2em]">Out Party Section</h2>
            {isLaptop && (
              <button onClick={addOutParty} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-2xl text-xs font-black shadow-lg transition-all">+ NEW PARTY</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[11px] font-black text-slate-400 uppercase bg-slate-50/50 border-b">
                  <th className="px-8 py-4 w-20">#</th>
                  <th className="px-8 py-4">Method</th>
                  <th className="px-8 py-4">Amount (Rs)</th>
                  {isLaptop && <th className="px-8 py-4 text-right">Action</th>}
                </tr>
              </thead>
              <tbody>
                {appState.currentDay.outPartyEntries.map((entry, i) => (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-slate-50/50 transition-colors">
                    <td className="px-8 py-5 font-black text-slate-950 text-xl">{i + 1}</td>
                    <td className="px-8 py-5">
                      {isLaptop ? (
                        <select 
                          value={entry.method} 
                          onChange={(e) => updateOutParty(entry.id, 'method', e.target.value as PaymentMethod)}
                          className="bg-slate-100 font-black rounded-xl px-4 py-3 text-sm outline-none border-2 border-transparent focus:border-sky-500 w-full md:w-48"
                        >
                          <option value={PaymentMethod.CASH}>CASH</option>
                          <option value={PaymentMethod.CARD}>CARD</option>
                          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
                        </select>
                      ) : (
                        <span className={`px-4 py-1.5 rounded-full text-[11px] font-black uppercase ${
                          entry.method === PaymentMethod.CASH ? 'bg-blue-100 text-blue-700' : 
                          entry.method === PaymentMethod.CARD ? 'bg-yellow-100 text-yellow-700' : 'bg-purple-100 text-purple-700'
                        }`}>{entry.method}</span>
                      )}
                    </td>
                    <td className="px-8 py-5">
                      {isLaptop ? (
                        <input 
                          type="number" 
                          value={entry.amount || ''} 
                          onChange={(e) => updateOutParty(entry.id, 'amount', Number(e.target.value))}
                          className="bg-slate-100 font-black rounded-xl px-5 py-3 w-full outline-none border-2 border-transparent focus:border-sky-500 text-slate-950 text-lg"
                        />
                      ) : (
                        <span className="font-black text-slate-950 text-2xl tracking-tighter">{formatLKR(entry.amount)}</span>
                      )}
                    </td>
                    {isLaptop && (
                      <td className="px-8 py-5 text-right">
                        <button onClick={() => deleteEntry(entry.id, 'OP')} className="text-red-400 hover:text-red-600 p-2 bg-red-50 rounded-lg">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* OUT PARTY TOTALS (Rule 7, 13, 17) */}
          <div className="grid grid-cols-1 md:grid-cols-3 bg-slate-950 text-white border-t-4 border-slate-900">
             <div className="p-8 border-r border-white/5 text-center bg-blue-600/5">
                <p className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] mb-2">Out Party Cash Total</p>
                <p className="text-4xl font-black text-blue-500 tracking-tighter">{formatLKR(totals.opCash)}</p>
             </div>
             <div className="p-8 border-r border-white/5 text-center bg-yellow-400/5">
                <p className="text-[10px] font-black text-yellow-400 uppercase tracking-[0.2em] mb-2">Out Party Card Total</p>
                <p className="text-4xl font-black text-yellow-500 tracking-tighter">{formatLKR(totals.opCard)}</p>
             </div>
             <div className="p-8 text-center bg-purple-400/5">
                <p className="text-[10px] font-black text-purple-400 uppercase tracking-[0.2em] mb-2">Out Party PayPal Total</p>
                <p className="text-4xl font-black text-purple-500 tracking-tighter">{formatLKR(totals.opPaypal)}</p>
             </div>
          </div>
        </section>

        {/* SECTION 2: MAIN SECTION (Rule 10) */}
        <section className="bg-white rounded-[2.5rem] shadow-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-8 py-5 flex justify-between items-center border-b border-slate-200">
            <h2 className="text-sm font-black text-slate-400 uppercase tracking-[0.2em]">Main Cash Flow</h2>
            {isLaptop && (
              <button onClick={addMainEntry} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-2xl text-xs font-black shadow-lg transition-all">+ NEW ENTRY</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left table-fixed min-w-[1000px]">
              <thead>
                <tr className="text-[11px] font-black text-slate-400 uppercase bg-slate-50/50 border-b">
                  <th className="px-6 py-4 w-28">Room No</th>
                  <th className="px-6 py-4 w-[350px]">Descriptions</th>
                  <th className="px-6 py-4 w-40">Method</th>
                  <th className="px-6 py-4 w-48">Cash In (Rs)</th>
                  <th className="px-6 py-4 w-48">Cash Out (Rs)</th>
                  {isLaptop && <th className="px-6 py-4 w-20 text-right">Del</th>}
                </tr>
              </thead>
              <tbody>
                {appState.currentDay.mainEntries.map(entry => (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-5">
                      {isLaptop ? (
                        <input value={entry.roomNo} onChange={e => updateMainEntry(entry.id, 'roomNo', e.target.value)} className="w-full bg-slate-100 font-black p-4 text-sm rounded-xl outline-none focus:ring-2 ring-sky-500" placeholder="RM#"/>
                      ) : <span className="font-black text-slate-900 text-xl">{entry.roomNo}</span>}
                    </td>
                    <td className="px-6 py-5">
                      {isLaptop ? (
                        <textarea value={entry.description} onChange={e => updateMainEntry(entry.id, 'description', e.target.value)} className="w-full bg-slate-100 font-black p-4 text-sm rounded-xl outline-none focus:ring-2 ring-sky-500 resize-none" rows={1} placeholder="Details..."/>
                      ) : <span className="font-black text-slate-950 text-lg leading-tight break-words">{entry.description}</span>}
                    </td>
                    <td className="px-6 py-5">
                      {isLaptop ? (
                        <select value={entry.method} onChange={e => updateMainEntry(entry.id, 'method', e.target.value)} className="w-full bg-slate-100 font-black p-4 text-sm rounded-xl outline-none">
                          <option value={PaymentMethod.CASH}>CASH</option>
                          <option value={PaymentMethod.CARD}>CARD</option>
                          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
                        </select>
                      ) : <span className="text-[10px] font-black opacity-30 uppercase tracking-widest">{entry.method}</span>}
                    </td>
                    <td className="px-6 py-5">
                      {isLaptop ? (
                        <input type="number" value={entry.cashIn || ''} onChange={e => updateMainEntry(entry.id, 'cashIn', Number(e.target.value))} className="w-full bg-blue-50 text-blue-700 font-black p-4 text-xl rounded-xl outline-none border-2 border-transparent focus:border-blue-500" placeholder="0"/>
                      ) : <span className="font-black text-blue-600 text-2xl tracking-tighter">{formatLKR(entry.cashIn)}</span>}
                    </td>
                    <td className="px-6 py-5">
                      {isLaptop ? (
                        <input type="number" value={entry.cashOut || ''} onChange={e => updateMainEntry(entry.id, 'cashOut', Number(e.target.value))} className="w-full bg-red-50 text-red-700 font-black p-4 text-xl rounded-xl outline-none border-2 border-transparent focus:border-red-500" placeholder="0"/>
                      ) : <span className="font-black text-red-600 text-2xl tracking-tighter">{formatLKR(entry.cashOut)}</span>}
                    </td>
                    {isLaptop && (
                      <td className="px-6 py-5 text-right">
                        <button onClick={() => deleteEntry(entry.id, 'MAIN')} className="text-red-300 hover:text-red-600">
                           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* MAIN SECTION TOTALS (Rule 10, 14, 15, 17) */}
          <div className="grid grid-cols-2 md:grid-cols-4 p-8 gap-6 bg-slate-900 border-t-4 border-slate-950">
             <div className="p-6 bg-slate-800 rounded-3xl border border-yellow-500/30 text-center">
                <p className="text-[10px] font-black text-yellow-500 uppercase mb-2 tracking-widest">Card Total Amt</p>
                <p className="text-2xl font-black text-white">{formatLKR(totals.mainCardTotal)}</p>
             </div>
             <div className="p-6 bg-slate-800 rounded-3xl border border-purple-500/30 text-center">
                <p className="text-[10px] font-black text-purple-500 uppercase mb-2 tracking-widest">PayPal Total Amt</p>
                <p className="text-2xl font-black text-white">{formatLKR(totals.mainPaypalTotal)}</p>
             </div>
             <div className="p-6 bg-blue-600 rounded-3xl shadow-xl text-center">
                <p className="text-[10px] font-black text-blue-100 uppercase mb-2 tracking-widest">Cash In Total</p>
                <p className="text-2xl font-black text-white">{formatLKR(totals.mainCashInTotal)}</p>
             </div>
             <div className="p-6 bg-red-600 rounded-3xl shadow-xl text-center">
                <p className="text-[10px] font-black text-red-100 uppercase mb-2 tracking-widest">Cash Out Total</p>
                <p className="text-2xl font-black text-white">{formatLKR(totals.mainCashOutTotal)}</p>
             </div>
          </div>
        </section>

        {/* FINAL SUMMARY (Rule 16, 17) */}
        <section className="bg-slate-950 rounded-[4rem] p-10 md:p-20 flex flex-col md:flex-row justify-between items-center shadow-2xl relative overflow-hidden border-8 border-sky-950">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-sky-500/10 blur-[150px] rounded-full pointer-events-none"></div>
          <div className="absolute -bottom-20 -left-20 w-[400px] h-[400px] bg-indigo-500/10 blur-[120px] rounded-full pointer-events-none"></div>
          
          <div className="text-center md:text-left z-10">
            <h3 className="text-sky-400 font-black text-sm uppercase tracking-[0.6em] mb-8">Net Cash Book Balance</h3>
            <div className="text-7xl md:text-[10rem] font-black text-white tracking-tighter tabular-nums drop-shadow-2xl leading-none">
              {formatLKR(totals.finalBalance) || 'Rs 0'}
            </div>
          </div>
          
          {isLaptop && (
            <button 
              onClick={handleDayEnd}
              className="mt-16 md:mt-0 bg-white hover:bg-sky-50 text-slate-950 px-20 py-10 rounded-[3rem] font-black text-3xl shadow-2xl transition-all hover:scale-105 active:scale-95 uppercase tracking-tighter"
            >
              DAY END CLOSE
            </button>
          )}
        </section>
      </main>

      {/* SYNC STATUS OVERLAY */}
      <div className="fixed bottom-8 left-8 flex gap-4 z-40">
        <div className="bg-white/90 backdrop-blur-xl px-6 py-4 rounded-3xl shadow-2xl border border-slate-200 flex items-center gap-4">
           <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse shadow-lg shadow-green-500/50"></div>
           <span className="text-[11px] font-black uppercase text-slate-500 tracking-widest">Live Link: <span className="text-slate-950">{appState.cabinId}</span></span>
        </div>
      </div>

      {/* HISTORY BUTTON (Rule 21) */}
      <button 
        onClick={() => {
          if (appState.history.length === 0) return alert("Archive is empty. Perform 'Day End' to save data.");
          const summary = appState.history.map(h => `📅 ${h.date}: Balance Rs ${calculateTotals(h).finalBalance.toLocaleString()}`).join('\n');
          alert(`SHIVAS BEACH ARCHIVE:\n\n${summary}`);
        }}
        className="fixed bottom-8 right-8 bg-slate-950 text-white px-10 py-6 rounded-full font-black text-xs uppercase shadow-2xl z-40 border border-slate-800 hover:bg-slate-900 transition-all flex items-center gap-3 active:scale-95"
      >
        <svg className="w-6 h-6 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        Archive History ({appState.history.length})
      </button>
    </div>
  );
};

export default App;
