
import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  // --- Persistent Role Selection ---
  const [role, setRole] = useState<DeviceRole>(() => {
    const savedRole = localStorage.getItem('shivas_device_role');
    if (savedRole) return savedRole as DeviceRole;
    // Auto-detect but default to Mobile if tiny screen
    return window.innerWidth < 1024 ? DeviceRole.MOBILE : DeviceRole.LAPTOP;
  });

  const [appState, setAppState] = useState<AppState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
    
    return {
      currentDay: {
        date: new Date().toLocaleDateString(),
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

  const isEditor = role === DeviceRole.LAPTOP;
  const totals = useMemo(() => calculateTotals(appState.currentDay), [appState.currentDay]);

  // --- Real-time Cloud Sync Logic ---
  useEffect(() => {
    const channel = new BroadcastChannel('shivas_cloud_relay');
    
    const handleSync = (event: MessageEvent) => {
      if (event.data.type === 'CLOUD_SYNC' && event.data.cabinId === appState.cabinId) {
        setAppState(prev => ({ ...prev, ...event.data.state }));
      }
    };
    channel.addEventListener('message', handleSync);

    // Auto-reconnect: Sync data when browser reopens or tab focuses
    const onFocus = () => {
      const latest = localStorage.getItem(STORAGE_KEY);
      if (latest) {
        const parsed = JSON.parse(latest);
        if (parsed.cabinId === appState.cabinId) {
          setAppState(parsed);
        }
      }
    };
    window.addEventListener('focus', onFocus);

    return () => {
      channel.removeEventListener('message', handleSync);
      window.removeEventListener('focus', onFocus);
      channel.close();
    };
  }, [appState.cabinId]);

  // Persistence Hook
  useEffect(() => {
    if (appState.cabinId) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
      const channel = new BroadcastChannel('shivas_cloud_relay');
      channel.postMessage({ type: 'CLOUD_SYNC', cabinId: appState.cabinId, state: appState });
    }
  }, [appState]);

  // Rates Hook
  useEffect(() => {
    const getRates = async () => {
      const rates = await fetchLiveExchangeRates();
      setAppState(prev => ({ ...prev, rates }));
    };
    getRates();
  }, []);

  // --- State Actions ---
  const pairDevice = (id: string) => {
    if (!id) return alert("Please enter a Cabin ID");
    setAppState(prev => ({ ...prev, cabinId: id.toUpperCase(), isPaired: true }));
  };

  const changeRole = (newRole: DeviceRole) => {
    setRole(newRole);
    localStorage.setItem('shivas_device_role', newRole);
  };

  const addOutParty = () => {
    if (!isEditor) return;
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
    if (!isEditor) return;
    setAppState(prev => ({
      ...prev,
      currentDay: {
        ...prev.currentDay,
        outPartyEntries: prev.currentDay.outPartyEntries.map(e => e.id === id ? { ...e, [field]: value } : e)
      }
    }));
  };

  const addMainEntry = () => {
    if (!isEditor) return;
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
    if (!isEditor) return;
    setAppState(prev => ({
      ...prev,
      currentDay: {
        ...prev.currentDay,
        mainEntries: prev.currentDay.mainEntries.map(e => e.id === id ? { ...e, [field]: value } : e)
      }
    }));
  };

  const deleteEntry = (id: string, section: 'OP' | 'MAIN') => {
    if (!isEditor) return;
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
    if (!isEditor || !window.confirm("Perform Day End? Today's data will be archived and cleared for a new day.")) return;
    setAppState(prev => ({
      ...prev,
      history: [...prev.history, prev.currentDay],
      currentDay: {
        date: new Date().toLocaleDateString(),
        outPartyEntries: [],
        mainEntries: [],
        openingBalance: totals.finalBalance
      }
    }));
  };

  // --- Pairing Screen ---
  if (!appState.isPaired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-[2.5rem] p-10 shadow-2xl text-center">
          <h1 className="text-4xl font-black text-sky-400 mb-2">SHIVAS BEACH</h1>
          <p className="text-slate-500 text-sm mb-8 font-bold uppercase tracking-widest">Live Cloud Cash Book</p>
          <input 
            type="text" 
            placeholder="ENTER CABIN ID" 
            className="w-full bg-slate-800 border-2 border-slate-700 rounded-2xl px-4 py-5 text-white font-black text-center mb-6 focus:border-sky-500 outline-none uppercase text-lg"
            onKeyDown={(e) => {
              if (e.key === 'Enter') pairDevice((e.target as HTMLInputElement).value);
            }}
          />
          <button 
            onClick={() => {
              const input = document.querySelector('input') as HTMLInputElement;
              pairDevice(input.value);
            }}
            className="w-full bg-sky-500 hover:bg-sky-400 text-slate-950 font-black py-5 rounded-2xl shadow-lg transition-all active:scale-95"
          >
            START LIVE SYNC
          </button>
        </div>
      </div>
    );
  }

  // --- Main App Screen ---
  return (
    <div className="min-h-screen bg-slate-100 text-slate-950 pb-24 font-bold">
      {/* Header */}
      <header className="bg-slate-950 text-white p-5 sticky top-0 z-50 shadow-2xl">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-center md:text-left">
            <h1 className="text-2xl md:text-3xl font-black tracking-tighter text-sky-400">SHIVAS BEACH CABANAS</h1>
            <div className="flex flex-wrap justify-center md:justify-start gap-4 text-[11px] font-black uppercase tracking-wider opacity-80 mt-1">
              <span className="bg-slate-800 px-2 py-0.5 rounded text-white">{appState.currentDay.date}</span>
              <span className="text-sky-300">USD {appState.rates.usd} LKR</span>
              <span className="text-indigo-300">EURO {appState.rates.euro} LKR</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-emerald-500/20 text-emerald-400 px-4 py-2 rounded-xl text-xs font-black border border-emerald-500/30 flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
              ID: {appState.cabinId}
            </div>
            <select 
              value={role} 
              onChange={(e) => changeRole(e.target.value as DeviceRole)}
              className="bg-slate-800 text-white px-3 py-2 rounded-xl text-xs font-black uppercase outline-none focus:ring-2 ring-sky-500"
            >
              <option value={DeviceRole.LAPTOP}>💻 LAPTOP (EDITOR)</option>
              <option value={DeviceRole.MOBILE}>📱 MOBILE (VIEWER)</option>
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-10">
        
        {/* Out Party Section */}
        <section className="bg-white rounded-[2.5rem] shadow-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-8 py-5 flex justify-between items-center border-b border-slate-200">
            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Out Party Section</h2>
            {isEditor && (
              <button onClick={addOutParty} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-2xl text-xs font-black shadow-lg transition-all">+ ADD NEW PARTY</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs font-black text-slate-400 uppercase bg-slate-50/50 border-b">
                  <th className="px-8 py-4 w-20">#</th>
                  <th className="px-8 py-4">Method</th>
                  <th className="px-8 py-4">Amount (Rs)</th>
                  {isEditor && <th className="px-8 py-4 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {appState.currentDay.outPartyEntries.map((entry, i) => (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-slate-50 transition-colors">
                    <td className="px-8 py-5 font-black text-slate-900 text-lg">{i + 1}</td>
                    <td className="px-8 py-5">
                      {isEditor ? (
                        <select 
                          value={entry.method} 
                          onChange={(e) => updateOutParty(entry.id, 'method', e.target.value)}
                          className="bg-slate-100 font-black rounded-xl px-4 py-2.5 text-sm outline-none border-2 border-transparent focus:border-sky-500 w-full md:w-48"
                        >
                          <option value={PaymentMethod.CASH}>CASH</option>
                          <option value={PaymentMethod.CARD}>CARD</option>
                          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
                        </select>
                      ) : (
                        <span className={`px-4 py-1.5 rounded-full text-xs font-black inline-block ${
                          entry.method === PaymentMethod.CASH ? 'bg-blue-100 text-blue-700' : 
                          entry.method === PaymentMethod.CARD ? 'bg-yellow-100 text-yellow-700' : 'bg-purple-100 text-purple-700'
                        }`}>{entry.method}</span>
                      )}
                    </td>
                    <td className="px-8 py-5">
                      {isEditor ? (
                        <input 
                          type="number" 
                          value={entry.amount || ''} 
                          onChange={(e) => updateOutParty(entry.id, 'amount', Number(e.target.value))}
                          className="bg-slate-100 font-black rounded-xl px-4 py-2.5 w-full outline-none border-2 border-transparent focus:border-sky-500 text-slate-950"
                          placeholder="0"
                        />
                      ) : (
                        <span className="font-black text-slate-950 text-xl">Rs {entry.amount > 0 ? entry.amount.toLocaleString() : ''}</span>
                      )}
                    </td>
                    {isEditor && (
                      <td className="px-8 py-5 text-right">
                        <button onClick={() => deleteEntry(entry.id, 'OP')} className="text-red-400 hover:text-red-600 p-2">
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Out Party Totals Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 border-t-4 border-slate-950 bg-slate-900 text-white">
             <div className="p-6 border-r border-slate-800 text-center">
                <p className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] mb-1">Out Party Cash Total</p>
                <p className="text-3xl font-black">Rs {totals.opCash.toLocaleString()}</p>
             </div>
             <div className="p-6 border-r border-slate-800 text-center bg-yellow-600/10">
                <p className="text-[10px] font-black text-yellow-400 uppercase tracking-[0.2em] mb-1">Out Party Card Total</p>
                <p className="text-3xl font-black text-yellow-500">Rs {totals.opCard.toLocaleString()}</p>
             </div>
             <div className="p-6 text-center bg-purple-600/10">
                <p className="text-[10px] font-black text-purple-400 uppercase tracking-[0.2em] mb-1">Out Party PayPal Total</p>
                <p className="text-3xl font-black text-purple-500">Rs {totals.opPaypal.toLocaleString()}</p>
             </div>
          </div>
        </section>

        {/* Main Section */}
        <section className="bg-white rounded-[2.5rem] shadow-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-8 py-5 flex justify-between items-center border-b border-slate-200">
            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Main Section</h2>
            {isEditor && (
              <button onClick={addMainEntry} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-2xl text-xs font-black shadow-lg transition-all">+ ADD MAIN ENTRY</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left table-fixed min-w-[1000px]">
              <thead>
                <tr className="text-xs font-black text-slate-400 uppercase bg-slate-50/50 border-b">
                  <th className="px-6 py-4 w-24">Room No</th>
                  <th className="px-6 py-4 w-80">Descriptions</th>
                  <th className="px-6 py-4 w-40">Payment Method</th>
                  <th className="px-6 py-4 w-48">Cash In (Rs)</th>
                  <th className="px-6 py-4 w-48">Cash Out (Rs)</th>
                  {isEditor && <th className="px-6 py-4 w-24 text-right">Action</th>}
                </tr>
              </thead>
              <tbody>
                {appState.currentDay.mainEntries.map(entry => (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-5">
                      {isEditor ? (
                        <input value={entry.roomNo} onChange={e => updateMainEntry(entry.id, 'roomNo', e.target.value)} className="w-full bg-slate-100 font-black p-3 text-sm rounded-xl outline-none focus:ring-2 ring-sky-500" placeholder="RM#"/>
                      ) : <span className="font-black text-lg">{entry.roomNo}</span>}
                    </td>
                    <td className="px-6 py-5">
                      {isEditor ? (
                        <input value={entry.description} onChange={e => updateMainEntry(entry.id, 'description', e.target.value)} className="w-full bg-slate-100 font-black p-3 text-sm rounded-xl outline-none focus:ring-2 ring-sky-500" placeholder="Details..."/>
                      ) : <span className="font-black text-slate-900 leading-tight">{entry.description}</span>}
                    </td>
                    <td className="px-6 py-5">
                      {isEditor ? (
                        <select value={entry.method} onChange={e => updateMainEntry(entry.id, 'method', e.target.value)} className="w-full bg-slate-100 font-black p-3 text-sm rounded-xl outline-none focus:ring-2 ring-sky-500">
                          <option value={PaymentMethod.CASH}>CASH</option>
                          <option value={PaymentMethod.CARD}>CARD</option>
                          <option value={PaymentMethod.PAYPAL}>PAY PAL</option>
                        </select>
                      ) : <span className="text-[10px] font-black px-2 py-1 bg-slate-200 rounded uppercase">{entry.method}</span>}
                    </td>
                    <td className="px-6 py-5">
                      {isEditor ? (
                        <input type="number" value={entry.cashIn || ''} onChange={e => updateMainEntry(entry.id, 'cashIn', Number(e.target.value))} className="w-full bg-blue-50 text-blue-700 font-black p-3 text-lg rounded-xl outline-none focus:ring-2 ring-blue-500" placeholder="0"/>
                      ) : <span className="font-black text-blue-600 text-xl">{entry.cashIn > 0 ? entry.cashIn.toLocaleString() : ''}</span>}
                    </td>
                    <td className="px-6 py-5">
                      {isEditor ? (
                        <input type="number" value={entry.cashOut || ''} onChange={e => updateMainEntry(entry.id, 'cashOut', Number(e.target.value))} className="w-full bg-red-50 text-red-700 font-black p-3 text-lg rounded-xl outline-none focus:ring-2 ring-red-500" placeholder="0"/>
                      ) : <span className="font-black text-red-600 text-xl">{entry.cashOut > 0 ? entry.cashOut.toLocaleString() : ''}</span>}
                    </td>
                    {isEditor && (
                      <td className="px-6 py-5 text-right">
                        <button onClick={() => deleteEntry(entry.id, 'MAIN')} className="text-red-400 hover:text-red-600">
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Main Totals Section */}
          <div className="grid grid-cols-2 md:grid-cols-4 p-8 gap-6 bg-slate-50 border-t-2 border-slate-200">
             <div className="p-5 bg-white rounded-3xl border-2 border-yellow-200 shadow-sm text-center">
                <p className="text-[10px] font-black text-yellow-600 uppercase mb-1">Card Total Amount</p>
                <p className="text-2xl font-black text-slate-950">Rs {totals.mainCardTotal.toLocaleString()}</p>
             </div>
             <div className="p-5 bg-white rounded-3xl border-2 border-purple-200 shadow-sm text-center">
                <p className="text-[10px] font-black text-purple-600 uppercase mb-1">PayPal Total Amount</p>
                <p className="text-2xl font-black text-slate-950">Rs {totals.mainPaypalTotal.toLocaleString()}</p>
             </div>
             <div className="p-5 bg-blue-600 rounded-3xl shadow-xl text-center">
                <p className="text-[10px] font-black text-blue-200 uppercase mb-1">Main Cash In Total</p>
                <p className="text-2xl font-black text-white">Rs {totals.mainCashInTotal.toLocaleString()}</p>
             </div>
             <div className="p-5 bg-red-600 rounded-3xl shadow-xl text-center">
                <p className="text-[10px] font-black text-red-200 uppercase mb-1">Main Cash Out Total</p>
                <p className="text-2xl font-black text-white">Rs {totals.mainCashOutTotal.toLocaleString()}</p>
             </div>
          </div>
        </section>

        {/* Grand Highlight Section */}
        <section className="bg-slate-950 rounded-[3.5rem] p-10 md:p-16 flex flex-col md:flex-row justify-between items-center shadow-2xl relative overflow-hidden border-4 border-sky-900/30">
          <div className="absolute -top-10 -right-10 w-80 h-80 bg-sky-500/10 blur-[120px] rounded-full"></div>
          <div className="absolute -bottom-10 -left-10 w-80 h-80 bg-indigo-500/10 blur-[120px] rounded-full"></div>
          
          <div className="text-center md:text-left z-10">
            <h3 className="text-sky-400 font-black text-sm uppercase tracking-[0.4em] mb-6">Final Cash Book Balance</h3>
            <div className="text-6xl md:text-9xl font-black text-white tabular-nums tracking-tighter drop-shadow-lg">
              Rs {totals.finalBalance.toLocaleString()}
            </div>
          </div>
          
          {isEditor && (
            <button 
              onClick={handleDayEnd}
              className="mt-12 md:mt-0 bg-white hover:bg-sky-50 text-slate-950 px-16 py-8 rounded-[2.5rem] font-black text-2xl shadow-2xl transition-all hover:scale-105 active:scale-95 uppercase tracking-tighter"
            >
              DAY END CLOSE
            </button>
          )}
        </section>
      </main>

      {/* Persistence Info Overlay */}
      <div className="fixed bottom-6 left-6 flex gap-4 z-50">
        <div className="bg-white/90 backdrop-blur-md px-5 py-3 rounded-2xl shadow-2xl border border-slate-200 flex items-center gap-3">
           <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse"></div>
           <span className="text-[11px] font-black uppercase text-slate-600">Auto-Linked: <span className="text-slate-950">{appState.cabinId}</span></span>
        </div>
      </div>

      <button 
        onClick={() => {
          if (appState.history.length === 0) return alert("No archive history found yet.");
          const summary = appState.history.map(h => `📅 ${h.date}: Final Balance Rs ${calculateTotals(h).finalBalance.toLocaleString()}`).join('\n');
          alert(`PAST DAYS COMPLETE ARCHIVE:\n\n${summary}`);
        }}
        className="fixed bottom-6 right-6 bg-slate-950 text-white px-8 py-5 rounded-full font-black text-xs uppercase shadow-2xl z-50 border border-slate-800 hover:bg-slate-900 transition-all flex items-center gap-2"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        Archive History ({appState.history.length})
      </button>
    </div>
  );
};

export default App;
