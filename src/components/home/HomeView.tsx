import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Zap, Shield, Cpu, MessageSquare, Code, Globe, Rocket, Heart, Edit2, Camera, User, Eye, Bot, HeartHandshake, ChevronDown, ShieldAlert, Bug, Lock, Coins, Unlock } from 'lucide-react';
import { ThemeMode, THEME_MODES, getThemeClasses } from '../../lib/theme';
import { cn } from '../../lib/utils';

interface HomeData {
  heroTitle: string;
  heroSubtitle: string;
  welcomeText: string;
  ctaText: string;
  features: Array<{
    title: string;
    subtitle: string;
    description: string;
    icon: string;
    color: string;
    status?: string;
  }>;
}

const ICON_MAP: Record<string, any> = {
  Heart, MessageSquare, Code, Shield, User, Eye, Bot, Sparkles, Zap, Rocket, Globe, HeartHandshake
};

export const HomeView = ({ onStartChat, onStartProChat, isAdmin, data, onUpdate, theme, user, onShowLogin }: { 
  onStartChat: () => void;
  onStartProChat?: () => void;
  isAdmin?: boolean;
  data?: HomeData;
  onUpdate?: (newData: HomeData) => void;
  theme: ThemeMode;
  user: any;
  onShowLogin: () => void;
}) => {
  const [currentIdx, setCurrentIdx] = useState(0);

  const colors = getThemeClasses(theme);

  const [viewportHeight, setViewportHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 800);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setViewportHeight(window.innerHeight);
    const handleResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isVeryShort = viewportHeight < 680;
  const isShort = viewportHeight < 780;

  // default fallback if no data provided
  const homeData = data || {
    heroTitle: 'NAVBHARAT AI',
    heroSubtitle: 'Experience the most advanced AI workspace built for the next billion developers and creators from Bharat.',
    welcomeText: 'Welcome to the Future',
    ctaText: 'Start Chatting Now',
    features: []
  };

  const featureList = homeData.features || [];

  useEffect(() => {
    if (featureList.length === 0) return;
    const timer = setInterval(() => {
      setCurrentIdx((prev) => (prev + 1) % featureList.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [featureList.length]);

  const updateData = (key: keyof HomeData, value: any) => {
    if (onUpdate) {
      onUpdate({ ...homeData, [key]: value });
    }
  };

  const updateFeature = (idx: number, key: string, value: any) => {
    if (onUpdate) {
      const newFeatures = [...featureList];
      newFeatures[idx] = { ...newFeatures[idx], [key]: value };
      onUpdate({ ...homeData, features: newFeatures });
    }
  };

  return (
    <div className={cn("flex-1 flex flex-col items-center justify-start text-center relative min-h-full w-full overflow-y-auto overflow-x-hidden p-6 py-4 transition-colors select-none", 
      isVeryShort ? "p-3 py-6" : isShort ? "p-4 py-8" : "p-6 py-4",
      colors.bg, colors.text
    )}>
      {/* Admin Status Indicator */}
      {isAdmin && (
        <div className="absolute top-6 right-6 z-50">
           <div className="bg-indigo-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-xl flex items-center gap-2">
              <Shield className="w-3.5 h-3.5" />
              Admin Mode: Home Page
           </div>
        </div>
      )}

      {/* Background Animated Elements */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            rotate: [0, 90, 0],
            opacity: [0.1, 0.2, 0.1]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute -top-1/4 -left-1/4 w-full h-full bg-indigo-600/10 rounded-full blur-[120px]"
        />
        <motion.div 
          animate={{ 
            scale: [1, 1.3, 1],
            rotate: [0, -90, 0],
            opacity: [0.1, 0.15, 0.1]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute -bottom-1/4 -right-1/4 w-full h-full bg-orange-500/10 rounded-full blur-[120px]"
        />
      </div>

      <div className={cn("z-10 max-w-6xl w-full flex flex-col md:flex-row items-center justify-between gap-x-12 gap-y-8 p-6")}>
        {/* Left Col: Title & CTA */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex-1 flex flex-col items-center md:items-start text-center md:text-left gap-y-4"
        >
          {/* Logo & Main Title (Moved to Left) */}
          <motion.img 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 100, delay: 0.15 }}
            src="/logo.png" 
            alt="navBharat AI Logo" 
            className="w-24 h-24 md:w-32 md:h-32 object-contain drop-shadow-[0_12px_28px_rgba(249,115,22,0.18)] select-none pointer-events-none"
            referrerPolicy="no-referrer"
          />

          <div className="inline-flex items-center gap-3 bg-white/5 border border-white/10 rounded-full px-6 py-2.5">
            <Sparkles className="w-4 h-4 text-orange-400" />
            <span className="font-black uppercase tracking-[0.3em] text-indigo-400 text-[10px]">{homeData.welcomeText}</span>
          </div>
          
          <h1 className="font-black text-white tracking-tighter italic leading-none text-4xl md:text-5xl">
            {homeData.heroTitle.split(' ').map((word, i) => (
              <span key={i} className={i === homeData.heroTitle.split(' ').length - 1 ? "text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 via-purple-500 to-orange-500" : ""}>
                {word}{' '}
              </span>
            ))}
          </h1>

          <p className="text-[#8b949e] font-medium max-w-md leading-relaxed text-sm">
            {homeData.heroSubtitle}
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 pt-2">
            <button 
              onClick={onStartChat}
              className="bg-gradient-to-r from-orange-500 to-amber-400 hover:from-orange-400 hover:to-amber-300 text-white font-black uppercase tracking-widest transition-all px-8 py-4 rounded-[2rem] text-xs flex items-center gap-2"
            >
              <MessageSquare className="w-4 h-4" />
              navBharatAI
            </button>
            <button 
              onClick={onStartProChat}
              className="bg-gradient-to-r from-purple-600 to-indigo-700 hover:from-purple-500 hover:to-indigo-600 text-white font-black uppercase tracking-widest transition-all px-8 py-4 rounded-[2rem] text-xs flex items-center gap-2"
            >
              <Bot className="w-4 h-4" />
              Pro 🇮🇳
            </button>
          </div>
        </motion.div>

        {/* Right Col: Features */}
        {featureList.length > 0 && (
          <div className="flex-1 w-full max-w-sm">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentIdx}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-[#161b22] border border-white/5 shadow-2xl p-6 rounded-3xl"
              >
                <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${featureList[currentIdx].color} opacity-10 blur-3xl`} />
                <div className="flex flex-col gap-4 text-left">
                  <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${featureList[currentIdx].color} flex items-center justify-center`}>
                    {React.createElement(ICON_MAP[featureList[currentIdx].icon] || Heart, { className: "w-6 h-6 text-white" })}
                  </div>
                  <h2 className="font-black text-white text-lg tracking-tight">{featureList[currentIdx].title}</h2>
                  <p className="text-[#8b949e] text-xs leading-relaxed">{featureList[currentIdx].description}</p>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};
