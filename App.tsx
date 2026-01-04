
import React, { useState, useEffect, useMemo } from 'react';
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
  // Device mode state
  const [role, setRole] = useState<DeviceRole>(() => {
    try {
      const saved = localStorage.getItem('shivas_device_mode');
      if (saved === DeviceRole.LAPTOP || saved === DeviceRole.MOBILE) return saved as DeviceRole;
      return window.innerWidth < 1024 ? DeviceRole.MOBILE : DeviceRole.LAPTOP;
    } catch (e) {
      return DeviceRole.MOBILE;
    }
  });

  // App data state
  const [appState, setAppState] = useState<AppState>(() => {
    const defaultState: AppState = {
      currentDay: createDefaultDay(),
      history: [],
      cabinId: '',
      rates: { usd: DEFAULT_LKR_USD, euro: DEFAULT_LKR_EURO },
      isPaired: false
    };

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return defaultState;
      
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object') return defaultState;

      return {
        ...defaultState,
        ...parsed,
        currentDay: {
          ...defaultState.currentDay,
          ...(parsed.currentDay || {}),
          outPartyEntries: Array.isArray(parsed.currentDay?.outPartyEntries) ? parsed.currentDay.outPartyEntries : [],
          mainEntries: Array.isArray(parsed.currentDay?.mainEntries) ? parsed.currentDay.mainEntries : []
        },
        history: Array.isArray(parsed.history) ? parsed.history : [],
        rates: parsed.rates || defaultState.rates
      };
    } catch (e) {
      return defaultState;
    }
  });

  // SYNC: Automatic reconnection across tabs and devices (simulation)
  useEffect(() => {
    const handleStorageSync = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const newState = JSON.parse(e.newValue);
          if (newState.cabinId === appState.cabinId) {
            setAppState(prev => ({ ...prev, ...newState }));
          }
        } catch (err) {}
      }
    };
    window.addEventListener('storage', handleStorageSync);

    const relay = new BroadcastChannel('shivas_cloud_relay');
    relay.onmessage = (e) => {
      if (e.data?.cabinId === appState.cabinId && e.data?.state) {
        setAppState(prev => ({ ...prev, ...e.data.state }));
      }
    };

    return () => {
      window.removeEventListener('storage', handleStorageSync);
      relay.close();
    };
  }, [appState.cabinId]);

  // Save changes and broadcast to other paired devices/tabs
  useEffect(() => {
    if (appState.isPaired) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
      const relay = new BroadcastChannel('shivas_cloud_relay');
      relay.postMessage({ cabinId: appState.cabinId, state: appState });
    }
  }, [appState]);

  // Initial fetch of exchange rates
  useEffect(() => {
    const getRates = async () => {
      const rates = await fetchLiveExchangeRates();
      setAppState(prev => ({ ...prev, rates }));
    };
    getRates();
  }, []);

  const isLaptop = role === DeviceRole.LAPTOP;
  const totals = useMemo(() => calculateTotals(appState.currentDay), [appState.currentDay]);

  const pairDevice = (id: string) => {
    const cleanId = id.trim().toUpperCase();
    if (!cleanId) return alert("Please enter a Cabin ID");
    setAppState(prev => ({ ...prev, cabinId: cleanId, isPaired: true }));
  };

  const setDeviceRole = (newRole: DeviceRole) => {
    setRole(newRole);
    localStorage.setItem('shivas_device_mode', newRole);
  };

  // CRUD Actions (Only allowed for Laptop/Editor)
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

  const deleteEntry = (id: string, isOutParty: boolean) => {
    if (!isLaptop) return;
    if (!window.confirm("Delete this record?")) return;
    setAppState(prev => ({
      ...prev,
      currentDay: {
        ...prev.currentDay,
        outPartyEntries: isOutParty ? prev.currentDay.outPartyEntries.filter(e => e.id !== id) : prev.currentDay.outPartyEntries,
        mainEntries: !isOutParty ? prev.currentDay.mainEntries.filter(e => e.id !== id) : prev.currentDay.mainEntries,
      }
    }));
  };

  const handleDayEnd = () => {
    if (!isLaptop) return;
    if (!window.confirm("Confirm DAY END? This will archive today's data and start a fresh book.")) return;
    setAppState(prev => ({
      ...prev,
      history: [prev.currentDay, ...prev.history],
      currentDay: createDefaultDay(totals.finalBalance)
    }));
  };

  const formatRs = (val: number) => {
    if (val === 0) return '';
    return `Rs ${val.toLocaleString()}`;
  };

  // --- PAIRING SCREEN ---
  if (!appState.isPaired) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6">
        <div className="bg-white p-8 md:p-12 rounded-[2.5rem] shadow-2xl max-w-md w-full border-t-8 border-sky-500">
          <div className="text-center mb-10">
            <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic">Shivas Beach</h1>
            <p className="text-sky-600 font-bold text-xs uppercase tracking-widest mt-1">Cloud Sync Terminal</p>
          </div>
          <div className="space-y-6">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Assign Device ID</label>
              <input 
                type="text" 
                placeholder="E.G. BEACH-01" 
                className="w-full bg-slate-50 border-2 border-slate-200 rounded-2xl px-6 py-4 text-slate-900 font-black text-center focus:border-sky-500 outline-none uppercase text-xl placeholder:text-slate-300"
                onKeyDown={(e) => e.key === 'Enter' && pairDevice((e.target as HTMLInputElement).value)}
              />
            </div>
            <button 
              onClick={() => pairDevice((document.querySelector('input') as HTMLInputElement).value)}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-black py-5 rounded-2xl transition-all shadow-xl active:scale-95 text-lg"
            >
              INITIALIZE SYNC
            </button>
            <p className="text-[10px] text-slate-400 text-center font-bold px-4 leading-relaxed">
              Use the same ID on your Laptop and Mobile devices to connect them automatically.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --- MAIN APP ---
  return (
    <div className="min-h-screen pb-20">
      {/* Header (Rule 9, 12) */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-black text-slate-950 tracking-tighter uppercase italic">SHIVAS BEACH CABANAS</h1>
            <div className="flex gap-4 text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">
              <span>{appState.currentDay.date}</span>
              <span className="text-blue-500">USD {appState.rates.usd}</span>
              <span className="text-indigo-500">EURO {appState.rates.euro}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <div className="hidden md:flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="text-[10px] font-black text-emerald-600 uppercase">Linked: {appState.cabinId}</span>
             </div>
             <select 
               value={role} 
               onChange={(e) => setDeviceRole(e.target.value as DeviceRole)}
               className="bg-slate-100 text-slate-900 text-xs font-black uppercase py-2 px-3 rounded-xl border-none outline-none cursor-pointer"
             >
               <option value={DeviceRole.LAPTOP}>💻 Laptop (Edit)</option>
               <option value={DeviceRole.MOBILE}>📱 Mobile (View)</option>
             </select>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-10">
        
        {/* Out Party Section (Rule 5, 6, 8) */}
        <section className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Out Party Entries</h2>
            {isLaptop && (
              <button onClick={addOutParty} className="bg-sky-600 hover:bg-sky-700 text-white text-[10px] font-black px-4 py-2 rounded-lg transition-all">+ NEW PARTY</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50/50 border-b border-slate-200 text-[10px] font-black text-slate-400 uppercase">
                <tr>
                  <th className="px-6 py-4 w-16 text-center">#</th>
                  <th className="px-6 py-4">Method</th>
                  <th className="px-6 py-4">Amount (Rs)</th>
                  {isLaptop && <th className="px-6 py-4 w-20 text-center">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-900 font-bold">
                {appState.currentDay.outPartyEntries.map((entry, i) => (
                  <tr key={entry.id} className="hover:bg-slate-50/50">
                    <td className="px-6 py-4 text-center text-slate-400">{i + 1}</td>
                    <td className="px-6 py-4">
                      {isLaptop ? (
                        <select 
                          value={entry.method} 
                          onChange={(e) => updateOutParty(entry.id, 'method', e.target.value as PaymentMethod)}
                          className="bg-white border border-slate-200 rounded-lg py-2 px-3 text-sm font-black w-full max-w-[150px]"
                        >
                          <option value={PaymentMethod.CASH}>CASH</option>
                          <option value={PaymentMethod.CARD}>CARD</option>
                          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
                        </select>
                      ) : (
                        <span className={`px-3 py-1 rounded-md text-[10px] font-black ${
                          entry.method === PaymentMethod.CASH ? 'bg-blue-100 text-blue-700' :
                          entry.method === PaymentMethod.CARD ? 'bg-yellow-100 text-yellow-700' :
                          'bg-purple-100 text-purple-700'
                        }`}>{entry.method}</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {isLaptop ? (
                        <input 
                          type="number" 
                          value={entry.amount || ''} 
                          onChange={(e) => updateOutParty(entry.id, 'amount', Number(e.target.value))}
                          className="w-full max-w-[200px] border-b-2 border-transparent focus:border-sky-500 py-2 outline-none text-xl font-black bg-transparent"
                          placeholder="0.00"
                        />
                      ) : (
                        <span className="text-xl font-black">{formatRs(entry.amount)}</span>
                      )}
                    </td>
                    {isLaptop && (
                      <td className="px-6 py-4 text-center">
                        <button onClick={() => deleteEntry(entry.id, true)} className="text-red-300 hover:text-red-500 transition-colors">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Out Party Summary Bars (Rule 7) */}
          <div className="grid grid-cols-1 md:grid-cols-3 bg-slate-50 border-t border-slate-200 font-black">
            <div className="p-6 border-b md:border-b-0 md:border-r border-slate-200">
              <p className="text-[10px] text-blue-500 uppercase tracking-widest mb-1">OP Cash Total</p>
              <p className="text-2xl text-slate-900">{formatRs(totals.opCash) || 'Rs 0'}</p>
            </div>
            <div className="p-6 border-b md:border-b-0 md:border-r border-slate-200">
              <p className="text-[10px] text-yellow-600 uppercase tracking-widest mb-1">OP Card Total</p>
              <p className="text-2xl text-slate-900">{formatRs(totals.opCard) || 'Rs 0'}</p>
            </div>
            <div className="p-6">
              <p className="text-[10px] text-purple-600 uppercase tracking-widest mb-1">OP PayPal Total</p>
              <p className="text-2xl text-slate-900">{formatRs(totals.opPaypal) || 'Rs 0'}</p>
            </div>
          </div>
        </section>

        {/* Main Section (Rule 5, 10, 14, 15) */}
        <section className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Main Cash Flow</h2>
            {isLaptop && (
              <button onClick={addMainEntry} className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black px-4 py-2 rounded-lg transition-all">+ NEW ENTRY</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left table-fixed min-w-[1000px]">
              <thead className="bg-slate-50/50 border-b border-slate-200 text-[10px] font-black text-slate-400 uppercase">
                <tr>
                  <th className="px-6 py-4 w-28">Room No</th>
                  <th className="px-6 py-4 w-auto">Descriptions</th>
                  <th className="px-6 py-4 w-40">Method</th>
                  <th className="px-6 py-4 w-48">Cash In (Rs)</th>
                  <th className="px-6 py-4 w-48">Cash Out (Rs)</th>
                  {isLaptop && <th className="px-6 py-4 w-16"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-900 font-bold">
                {appState.currentDay.mainEntries.map(entry => (
                  <tr key={entry.id} className="hover:bg-slate-50/50">
                    <td className="px-6 py-4">
                      {isLaptop ? (
                        <input value={entry.roomNo} onChange={e => updateMainEntry(entry.id, 'roomNo', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm font-black outline-none focus:border-sky-500" placeholder="RM #"/>
                      ) : <span className="text-lg font-black">{entry.roomNo}</span>}
                    </td>
                    <td className="px-6 py-4">
                      {isLaptop ? (
                        <textarea value={entry.description} onChange={e => updateMainEntry(entry.id, 'description', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm font-black outline-none focus:border-sky-500 resize-none" rows={1} placeholder="Enter details..."/>
                      ) : <span className="text-sm font-black leading-relaxed">{entry.description}</span>}
                    </td>
                    <td className="px-6 py-4">
                      {isLaptop ? (
                        <select value={entry.method} onChange={e => updateMainEntry(entry.id, 'method', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm font-black outline-none">
                          <option value={PaymentMethod.CASH}>CASH</option>
                          <option value={PaymentMethod.CARD}>CARD</option>
                          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
                        </select>
                      ) : <span className="text-[10px] font-black opacity-30">{entry.method}</span>}
                    </td>
                    <td className="px-6 py-4">
                      {isLaptop ? (
                        <input type="number" value={entry.cashIn || ''} onChange={e => updateMainEntry(entry.id, 'cashIn', Number(e.target.value))} className="w-full bg-blue-50/50 text-blue-700 border border-blue-100 rounded-lg p-3 text-lg font-black outline-none focus:border-blue-400" placeholder="0"/>
                      ) : <span className="text-lg font-black text-blue-600">{formatRs(entry.cashIn)}</span>}
                    </td>
                    <td className="px-6 py-4">
                      {isLaptop ? (
                        <input type="number" value={entry.cashOut || ''} onChange={e => updateMainEntry(entry.id, 'cashOut', Number(e.target.value))} className="w-full bg-red-50/50 text-red-700 border border-red-100 rounded-lg p-3 text-lg font-black outline-none focus:border-red-400" placeholder="0"/>
                      ) : <span className="text-lg font-black text-red-600">{formatRs(entry.cashOut)}</span>}
                    </td>
                    {isLaptop && (
                      <td className="px-6 py-4 text-right">
                        <button onClick={() => deleteEntry(entry.id, false)} className="text-slate-200 hover:text-red-500 transition-colors">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Main Summary Bar (Rule 10, 14, 15, 17) */}
          <div className="grid grid-cols-2 md:grid-cols-4 p-6 gap-6 bg-slate-900 border-t border-slate-950">
             <div className="bg-slate-800/50 p-5 rounded-2xl border border-yellow-500/20 text-center">
                <p className="text-[9px] font-black text-yellow-500 uppercase tracking-widest mb-1">Total Card Amt</p>
                <p className="text-xl font-black text-white">{formatRs(totals.mainCardTotal) || 'Rs 0'}</p>
             </div>
             <div className="bg-slate-800/50 p-5 rounded-2xl border border-purple-500/20 text-center">
                <p className="text-[9px] font-black text-purple-500 uppercase tracking-widest mb-1">Total PayPal Amt</p>
                <p className="text-xl font-black text-white">{formatRs(totals.mainPaypalTotal) || 'Rs 0'}</p>
             </div>
             <div className="bg-blue-600 p-5 rounded-2xl text-center shadow-lg shadow-blue-900/40">
                <p className="text-[9px] font-black text-blue-100 uppercase tracking-widest mb-1">Cash In Total</p>
                <p className="text-xl font-black text-white italic">{formatRs(totals.mainCashInTotal) || 'Rs 0'}</p>
             </div>
             <div className="bg-red-600 p-5 rounded-2xl text-center shadow-lg shadow-red-900/40">
                <p className="text-[9px] font-black text-red-100 uppercase tracking-widest mb-1">Cash Out Total</p>
                <p className="text-xl font-black text-white italic">{formatRs(totals.mainCashOutTotal) || 'Rs 0'}</p>
             </div>
          </div>
        </section>

        {/* Final Balance (Rule 16, 17) */}
        <section className="bg-slate-950 rounded-[3rem] p-12 md:p-20 shadow-2xl relative overflow-hidden flex flex-col md:flex-row items-center justify-between border-8 border-sky-950">
           <div className="absolute top-0 right-0 w-80 h-80 bg-sky-500/10 blur-[100px] rounded-full"></div>
           <div className="z-10 text-center md:text-left">
              <h3 className="text-sky-400 font-black text-xs uppercase tracking-[0.5em] mb-6">Current Cash Balance</h3>
              <div className="text-7xl md:text-9xl font-black text-white tracking-tighter drop-shadow-2xl tabular-nums italic">
                {formatRs(totals.finalBalance) || 'Rs 0'}
              </div>
           </div>
           {isLaptop && (
             <button 
               onClick={handleDayEnd}
               className="mt-12 md:mt-0 bg-white hover:bg-sky-50 text-slate-950 px-16 py-8 rounded-3xl font-black text-2xl shadow-2xl transition-all hover:scale-105 active:scale-95 uppercase tracking-tighter italic"
             >
               DAY END CLOSE
             </button>
           )}
        </section>

      </main>

      {/* Persistence Controls */}
      <div className="fixed bottom-6 right-6 flex gap-4 z-40">
        <button 
          onClick={() => {
            if (appState.history.length === 0) return alert("Archive is empty.");
            const hist = appState.history.map(h => `${h.date}: Balance ${formatRs(calculateTotals(h).finalBalance)}`).join('\n');
            alert(`CASH BOOK ARCHIVE:\n\n${hist}`);
          }}
          className="bg-white/90 backdrop-blur-md text-slate-900 px-6 py-4 rounded-2xl font-black text-xs uppercase shadow-2xl border border-slate-200 flex items-center gap-2 hover:bg-white transition-all"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          History ({appState.history.length})
        </button>
      </div>

      {/* Sync Status Badge (Bottom Left) */}
      <div className="fixed bottom-6 left-6 z-40">
        <div className="bg-slate-900/95 backdrop-blur-md px-5 py-3 rounded-2xl shadow-2xl border border-slate-800 flex items-center gap-3">
           <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse"></div>
           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Live: <span className="text-white">{appState.cabinId}</span></span>
        </div>
      </div>
    </div>
  );
};

export default App;
