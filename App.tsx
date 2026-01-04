
import React, { useState, useEffect, useMemo } from 'react';
import { 
  DeviceRole, 
  PaymentMethod, 
  AppState, 
  OutPartyEntry, 
  MainEntry 
} from './types';
import { STORAGE_KEY } from './constants';
import { calculateTotals } from './utils/calculations';
import { fetchLiveExchangeRates } from './services/geminiService';

const App: React.FC = () => {
  // 1. SAFE INITIALIZATION (Prevents Blank Page on Vercel)
  const [role, setRole] = useState<DeviceRole>(() => {
    try {
      const saved = localStorage.getItem('shivas_role');
      if (saved) return saved as DeviceRole;
      return window.innerWidth < 1024 ? DeviceRole.MOBILE : DeviceRole.LAPTOP;
    } catch (e) {
      return DeviceRole.LAPTOP;
    }
  });

  const [appState, setAppState] = useState<AppState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
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
      rates: { usd: 310, euro: 366 },
      isPaired: false
    };
  });

  // 2. LIVE CLOUD SYNC SIMULATION (Automatic Reconnect)
  // This uses the 'storage' event which syncs across tabs/windows automatically
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        setAppState(JSON.parse(e.newValue));
      }
    };
    window.addEventListener('storage', handleStorageChange);
    
    // BroadcastChannel for instant same-browser sync
    const channel = new BroadcastChannel('shivas_relay');
    channel.onmessage = (e) => {
      if (e.data.cabinId === appState.cabinId) {
        setAppState(e.data.state);
      }
    };

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      channel.close();
    };
  }, [appState.cabinId]);

  // Save and Broadcast changes
  useEffect(() => {
    if (appState.isPaired) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
      const channel = new BroadcastChannel('shivas_relay');
      channel.postMessage({ cabinId: appState.cabinId, state: appState });
    }
  }, [appState]);

  // Auto-fetch rates
  useEffect(() => {
    fetchLiveExchangeRates().then(rates => {
      setAppState(prev => ({ ...prev, rates }));
    });
  }, []);

  // 3. LOGIC HELPERS
  const isLaptop = role === DeviceRole.LAPTOP;
  const totals = useMemo(() => calculateTotals(appState.currentDay), [appState.currentDay]);

  const pairDevice = (id: string) => {
    const cleanId = id.trim().toUpperCase();
    if (!cleanId) return;
    setAppState(prev => ({ ...prev, cabinId: cleanId, isPaired: true }));
  };

  const updateRole = (newRole: DeviceRole) => {
    setRole(newRole);
    localStorage.setItem('shivas_role', newRole);
  };

  // 4. CRUD ACTIONS (Laptop Only)
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
    if (!isLaptop || !window.confirm("Delete this entry?")) return;
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
    if (!isLaptop || !window.confirm("Close Day? Data will be archived and cleared.")) return;
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

  // --- PAIRING UI ---
  if (!appState.isPaired) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="bg-slate-900 p-10 rounded-[2.5rem] border border-slate-800 shadow-2xl max-w-sm w-full text-center">
          <h1 className="text-3xl font-black text-sky-400 mb-6 tracking-tighter">SHIVAS BEACH</h1>
          <p className="text-slate-500 text-xs font-bold uppercase mb-8">Enter ID to Sync All Devices</p>
          <input 
            type="text" 
            placeholder="CABIN ID (e.g. CABIN-01)"
            className="w-full bg-slate-800 border-2 border-slate-700 rounded-2xl px-4 py-4 text-white font-black text-center mb-6 focus:border-sky-500 outline-none uppercase"
            onKeyDown={(e) => e.key === 'Enter' && pairDevice((e.target as HTMLInputElement).value)}
          />
          <button 
            onClick={() => {
              const val = (document.querySelector('input') as HTMLInputElement).value;
              pairDevice(val);
            }}
            className="w-full bg-sky-500 text-slate-950 font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all"
          >
            CONNECT NOW
          </button>
        </div>
      </div>
    );
  }

  // --- MAIN APP UI ---
  return (
    <div className="min-h-screen bg-slate-100 text-slate-950 font-bold selection:bg-sky-200">
      {/* Dynamic Header */}
      <header className="bg-slate-950 text-white p-5 sticky top-0 z-50 shadow-2xl border-b border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-center md:text-left">
            <h1 className="text-2xl font-black tracking-tighter text-sky-400">SHIVAS BEACH CABANAS</h1>
            <div className="flex gap-4 text-[10px] font-black uppercase opacity-60 mt-1">
              <span>{appState.currentDay.date}</span>
              <span className="text-sky-300">USD {appState.rates.usd}</span>
              <span className="text-indigo-300">EURO {appState.rates.euro}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-emerald-500/20 text-emerald-400 px-4 py-2 rounded-xl text-xs font-black border border-emerald-500/30 flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
              {appState.cabinId}
            </div>
            <select 
              value={role} 
              onChange={(e) => updateRole(e.target.value as DeviceRole)}
              className="bg-slate-800 text-white px-3 py-2 rounded-xl text-xs font-black uppercase outline-none"
            >
              <option value={DeviceRole.LAPTOP}>💻 LAPTOP (EDIT)</option>
              <option value={DeviceRole.MOBILE}>📱 MOBILE (VIEW)</option>
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-10">
        
        {/* SECTION 1: OUT PARTY */}
        <section className="bg-white rounded-[2rem] shadow-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-8 py-5 flex justify-between items-center border-b border-slate-200">
            <h2 className="text-sm font-black text-slate-400 uppercase tracking-[0.2em]">Out Party Section</h2>
            {isLaptop && (
              <button onClick={addOutParty} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-xl text-xs font-black transition-all">+ ADD PARTY</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[11px] font-black text-slate-400 uppercase bg-slate-50/50 border-b">
                  <th className="px-8 py-4 w-20">#</th>
                  <th className="px-8 py-4">Payment Method</th>
                  <th className="px-8 py-4">Amount (Rs)</th>
                  {isLaptop && <th className="px-8 py-4 text-right">Delete</th>}
                </tr>
              </thead>
              <tbody>
                {appState.currentDay.outPartyEntries.map((entry, i) => (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-slate-50 transition-colors">
                    <td className="px-8 py-5 font-black text-slate-900">{i + 1}</td>
                    <td className="px-8 py-5">
                      {isLaptop ? (
                        <select 
                          value={entry.method} 
                          onChange={(e) => updateOutParty(entry.id, 'method', e.target.value)}
                          className="bg-slate-100 font-black rounded-lg px-3 py-2 text-sm outline-none w-full md:w-48"
                        >
                          <option value={PaymentMethod.CASH}>CASH</option>
                          <option value={PaymentMethod.CARD}>CARD</option>
                          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
                        </select>
                      ) : (
                        <span className={`px-3 py-1 rounded text-[10px] font-black uppercase ${
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
                          className="bg-slate-100 font-black rounded-lg px-4 py-2 w-full outline-none text-slate-950"
                        />
                      ) : (
                        <span className="font-black text-slate-950 text-lg">Rs {entry.amount > 0 ? entry.amount.toLocaleString() : ''}</span>
                      )}
                    </td>
                    {isLaptop && (
                      <td className="px-8 py-5 text-right">
                        <button onClick={() => deleteEntry(entry.id, 'OP')} className="text-red-300 hover:text-red-600">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 bg-slate-950 text-white">
             <div className="p-6 border-r border-white/5 text-center">
                <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">OP Cash Total</p>
                <p className="text-3xl font-black">Rs {totals.opCash.toLocaleString()}</p>
             </div>
             <div className="p-6 border-r border-white/5 text-center bg-yellow-400/5">
                <p className="text-[10px] font-black text-yellow-400 uppercase tracking-widest mb-1">OP Card Total</p>
                <p className="text-3xl font-black text-yellow-500">Rs {totals.opCard.toLocaleString()}</p>
             </div>
             <div className="p-6 text-center bg-purple-400/5">
                <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest mb-1">OP PayPal Total</p>
                <p className="text-3xl font-black text-purple-500">Rs {totals.opPaypal.toLocaleString()}</p>
             </div>
          </div>
        </section>

        {/* SECTION 2: MAIN SECTION */}
        <section className="bg-white rounded-[2rem] shadow-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-8 py-5 flex justify-between items-center border-b border-slate-200">
            <h2 className="text-sm font-black text-slate-400 uppercase tracking-[0.2em]">Main Section</h2>
            {isLaptop && (
              <button onClick={addMainEntry} className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-xl text-xs font-black transition-all">+ ADD ENTRY</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left table-fixed min-w-[900px]">
              <thead>
                <tr className="text-[11px] font-black text-slate-400 uppercase bg-slate-50/50 border-b">
                  <th className="px-6 py-4 w-24">Room No</th>
                  <th className="px-6 py-4 w-80">Descriptions</th>
                  <th className="px-6 py-4 w-36">Method</th>
                  <th className="px-6 py-4 w-44">Cash In (Rs)</th>
                  <th className="px-6 py-4 w-44">Cash Out (Rs)</th>
                  {isLaptop && <th className="px-6 py-4 w-20 text-right">Del</th>}
                </tr>
              </thead>
              <tbody>
                {appState.currentDay.mainEntries.map(entry => (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-5">
                      {isLaptop ? (
                        <input value={entry.roomNo} onChange={e => updateMainEntry(entry.id, 'roomNo', e.target.value)} className="w-full bg-slate-100 font-black p-3 text-sm rounded-xl outline-none focus:ring-2 ring-sky-500" placeholder="RM#"/>
                      ) : <span className="font-black text-slate-900">{entry.roomNo}</span>}
                    </td>
                    <td className="px-6 py-5">
                      {isLaptop ? (
                        <input value={entry.description} onChange={e => updateMainEntry(entry.id, 'description', e.target.value)} className="w-full bg-slate-100 font-black p-3 text-sm rounded-xl outline-none focus:ring-2 ring-sky-500" placeholder="Details..."/>
                      ) : <span className="font-black text-slate-950">{entry.description}</span>}
                    </td>
                    <td className="px-6 py-5">
                      {isLaptop ? (
                        <select value={entry.method} onChange={e => updateMainEntry(entry.id, 'method', e.target.value)} className="w-full bg-slate-100 font-black p-3 text-sm rounded-xl outline-none">
                          <option value={PaymentMethod.CASH}>CASH</option>
                          <option value={PaymentMethod.CARD}>CARD</option>
                          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
                        </select>
                      ) : <span className="text-[10px] font-black opacity-30 uppercase">{entry.method}</span>}
                    </td>
                    <td className="px-6 py-5">
                      {isLaptop ? (
                        <input type="number" value={entry.cashIn || ''} onChange={e => updateMainEntry(entry.id, 'cashIn', Number(e.target.value))} className="w-full bg-blue-50 text-blue-700 font-black p-3 text-lg rounded-xl outline-none" placeholder="0"/>
                      ) : <span className="font-black text-blue-600 text-xl">{entry.cashIn > 0 ? entry.cashIn.toLocaleString() : ''}</span>}
                    </td>
                    <td className="px-6 py-5">
                      {isLaptop ? (
                        <input type="number" value={entry.cashOut || ''} onChange={e => updateMainEntry(entry.id, 'cashOut', Number(e.target.value))} className="w-full bg-red-50 text-red-700 font-black p-3 text-lg rounded-xl outline-none" placeholder="0"/>
                      ) : <span className="font-black text-red-600 text-xl">{entry.cashOut > 0 ? entry.cashOut.toLocaleString() : ''}</span>}
                    </td>
                    {isLaptop && (
                      <td className="px-6 py-5 text-right">
                        <button onClick={() => deleteEntry(entry.id, 'MAIN')} className="text-red-300 hover:text-red-600">
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 p-8 gap-6 bg-slate-50 border-t border-slate-200">
             <div className="p-5 bg-white rounded-2xl border-2 border-yellow-200 shadow-sm text-center">
                <p className="text-[10px] font-black text-yellow-600 uppercase mb-1">Main Card Total</p>
                <p className="text-xl font-black text-slate-950">Rs {totals.mainCardTotal.toLocaleString()}</p>
             </div>
             <div className="p-5 bg-white rounded-2xl border-2 border-purple-200 shadow-sm text-center">
                <p className="text-[10px] font-black text-purple-600 uppercase mb-1">Main PayPal Total</p>
                <p className="text-xl font-black text-slate-950">Rs {totals.mainPaypalTotal.toLocaleString()}</p>
             </div>
             <div className="p-5 bg-blue-600 rounded-2xl shadow-xl text-center">
                <p className="text-[10px] font-black text-blue-100 uppercase mb-1">Cash In Total</p>
                <p className="text-xl font-black text-white">Rs {totals.mainCashInTotal.toLocaleString()}</p>
             </div>
             <div className="p-5 bg-red-600 rounded-2xl shadow-xl text-center">
                <p className="text-[10px] font-black text-red-100 uppercase mb-1">Cash Out Total</p>
                <p className="text-xl font-black text-white">Rs {totals.mainCashOutTotal.toLocaleString()}</p>
             </div>
          </div>
        </section>

        {/* SECTION 3: FINAL BALANCE */}
        <section className="bg-slate-950 rounded-[3rem] p-10 md:p-16 flex flex-col md:flex-row justify-between items-center shadow-2xl relative overflow-hidden border-4 border-sky-950">
          <div className="absolute top-0 right-0 w-96 h-96 bg-sky-500/10 blur-[150px] rounded-full pointer-events-none"></div>
          <div className="text-center md:text-left z-10">
            <h3 className="text-sky-400 font-black text-xs uppercase tracking-[0.5em] mb-6">Final Net Balance</h3>
            <div className="text-6xl md:text-9xl font-black text-white tracking-tighter tabular-nums drop-shadow-2xl">
              Rs {totals.finalBalance.toLocaleString()}
            </div>
          </div>
          {isLaptop && (
            <button 
              onClick={handleDayEnd}
              className="mt-12 md:mt-0 bg-white hover:bg-sky-50 text-slate-950 px-16 py-8 rounded-[2rem] font-black text-2xl shadow-2xl transition-all hover:scale-105 active:scale-95 uppercase tracking-tighter"
            >
              DAY END CLOSE
            </button>
          )}
        </section>
      </main>

      {/* Persistence Info Overlay */}
      <div className="fixed bottom-6 left-6 flex gap-4 z-40">
        <div className="bg-white/80 backdrop-blur-md px-5 py-3 rounded-2xl shadow-xl border border-slate-200 flex items-center gap-3">
           <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse"></div>
           <span className="text-[10px] font-black uppercase text-slate-500">Auto-Linked: <span className="text-slate-950">{appState.cabinId}</span></span>
        </div>
      </div>

      <button 
        onClick={() => {
          if (appState.history.length === 0) return alert("No archives yet.");
          const summary = appState.history.map(h => `📅 ${h.date}: Balance Rs ${calculateTotals(h).finalBalance.toLocaleString()}`).join('\n');
          alert(`HISTORY ARCHIVE:\n\n${summary}`);
        }}
        className="fixed bottom-6 right-6 bg-slate-950 text-white px-8 py-5 rounded-full font-black text-xs uppercase shadow-2xl z-40 border border-slate-800 hover:bg-slate-900 transition-all flex items-center gap-2"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        Archive ({appState.history.length})
      </button>
    </div>
  );
};

export default App;
