
import React from 'react';

interface SyncBadgeProps {
  syncKey: string;
  isLaptop: boolean;
}

const SyncBadge: React.FC<SyncBadgeProps> = ({ syncKey, isLaptop }) => {
  return (
    <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/20 text-xs font-semibold">
      <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
      <span className="text-white opacity-80 uppercase tracking-wider">
        Cloud Link: <span className="font-mono text-white opacity-100">{syncKey}</span>
      </span>
      <span className={`px-2 py-0.5 rounded-full ${isLaptop ? 'bg-indigo-500' : 'bg-emerald-500'} text-white`}>
        {isLaptop ? 'MASTER' : 'VIEWER'}
      </span>
    </div>
  );
};

export default SyncBadge;
