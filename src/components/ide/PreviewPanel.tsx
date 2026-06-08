import React, { useState } from 'react';
import { 
  Monitor, Smartphone, Tablet, RefreshCcw, 
  ExternalLink, Maximize2, Shield, Globe,
  Search, ChevronLeft, ChevronRight
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface PreviewPanelProps {
  files: Record<string, string>;
  onRun: () => void;
  generatedCode?: string;
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({ files, onRun, generatedCode }) => {
  const [device, setDevice] = useState<'laptop' | 'mobile' | 'full'>('laptop');
  const [url, setUrl] = useState('http://localhost:3000');
  const [containerRef, setContainerRef] = React.useState<HTMLDivElement | null>(null);
  const [viewRef, setViewRef] = React.useState<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  React.useEffect(() => {
    if (!containerRef) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });
    observer.observe(containerRef);
    return () => observer.disconnect();
  }, [containerRef]);

  const targetWidth = 1440;
  const targetHeight = 900;

  const baseScale = dimensions?.width > 0 
    ? Math.min(dimensions.width / targetWidth, dimensions.height / targetHeight)
    : 1;

  const displayScale = device === 'full' 
    ? baseScale
    : device === 'mobile' && dimensions?.width < 400 && dimensions?.width > 0
      ? (dimensions.width - 32) / 375
      : 1;

  const devices = [
    { id: 'laptop' as const, label: 'Laptop', icon: Monitor, size: 'w-full max-w-[1280px]' },
    { id: 'mobile' as const, label: 'Mobile', icon: Smartphone, size: 'w-[375px]' },
    { id: 'full' as const, label: 'Full Screen', icon: Maximize2, size: 'w-full h-full' },
  ];

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      {/* Browser-like Header */}
      <div className="h-12 bg-[#161b22] border-b border-white/5 flex items-center px-4 gap-4 shrink-0 transition-all">
        <div className="flex items-center gap-1">
          <button className="p-2 hover:bg-white/5 rounded-full text-[#484f58]"><ChevronLeft className="w-4 h-4" /></button>
          <button className="p-2 hover:bg-white/5 rounded-full text-[#484f58]"><ChevronRight className="w-4 h-4" /></button>
          <button onClick={onRun} className="p-2 hover:bg-indigo-600/20 rounded-full text-indigo-400"><RefreshCcw className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 max-w-xl h-8 bg-black/40 border border-white/10 rounded-full px-4 flex items-center gap-2 group transition-all focus-within:border-indigo-500/50">
          <Shield className="w-3.5 h-3.5 text-emerald-500" />
          <input 
            value={url}
            readOnly
            className="flex-1 bg-transparent border-none outline-none text-[11px] text-[#8b949e] font-mono"
          />
          <Globe className="w-3.5 h-3.5 text-[#484f58]" />
        </div>

        <div className="flex items-center gap-1 bg-black/20 p-1 rounded-xl border border-white/5">
          {devices.map((d) => (
            <button
              key={d.id}
              onClick={() => setDevice(d.id)}
              title={d.label}
              className={cn(
                "p-2 rounded-lg transition-all flex items-center gap-2",
                device === d.id ? "bg-indigo-600 text-white shadow-lg" : "text-[#484f58] hover:text-[#8b949e]"
              )}
            >
              <d.icon className="w-4 h-4" />
              {device === d.id && <span className="text-[10px] font-bold uppercase tracking-widest hidden lg:block">{d.label}</span>}
            </button>
          ))}
        </div>

        <button className="p-2 hover:bg-white/5 rounded-full text-[#484f58] ml-2">
           <ExternalLink className="w-4 h-4" />
        </button>
      </div>

      {/* Preview Viewport */}
      <div 
        ref={setContainerRef}
        className="flex-1 bg-[#1e1e1e] p-4 flex justify-center items-center overflow-hidden relative"
      >
          <div 
            style={{
              width: device === 'full' ? `${targetWidth}px` : undefined,
              height: device === 'full' ? `${targetHeight}px` : undefined,
              transform: `scale(${displayScale})`,
              transformOrigin: 'center center',
              flexShrink: 0
            }}
            className={cn(
            "h-full bg-white shadow-2xl transition-all duration-300 rounded-lg overflow-hidden border-8 border-black/20",
            device === 'laptop' ? 'w-full max-w-[1280px]' : 
            device === 'mobile' ? 'w-[375px]' : ''
         )}>
            {generatedCode ? (
              <iframe
                title="App Preview"
                srcDoc={generatedCode}
                className="w-full h-full bg-white border-none"
                sandbox="allow-scripts allow-modals allow-same-origin"
              />
            ) : (
              <div className="w-full h-full bg-[#fafafa] flex flex-col items-center justify-center p-8 text-center space-y-4 animate-pulse">
                <Globe className="w-8.5 h-8.5 text-indigo-500 animate-spin" />
                <p className="text-xs text-gray-500 font-mono tracking-wider">Syncing workspace code...</p>
                <button 
                  onClick={onRun}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-full text-xs font-black uppercase tracking-widest hover:bg-indigo-700 active:scale-95 transition-all shadow-xl shadow-indigo-600/20"
                >
                  Sync Changes
                </button>
              </div>
            )}
         </div>
      </div>

      {/* Footer Info */}
      <div className="h-8 bg-[#161b22] border-t border-white/5 px-4 flex items-center justify-between text-[10px] text-[#484f58] font-bold uppercase tracking-widest">
         <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" /> Server: Port 3000</span>
            <span>DOM Inspect: Off</span>
         </div>
         <div>Responsive: {device.toUpperCase()}</div>
      </div>
    </div>
  );
};
