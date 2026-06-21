/**
 * Phase 1.7 — App.tsx split, Part 7: DonationPanel
 *
 * Extracted from App.tsx (was the `activeView === 'donation'` block, ~320 lines).
 * Shows the donation / support page with admin-editable content.
 */
import React from 'react';
import { motion } from 'motion/react';
import { Check, Edit2, Camera, Upload, QrCode, Copy, Heart, ExternalLink, HeartHandshake } from 'lucide-react';

export interface DonationData {
  headline: string;
  subHeadline: string;
  upiId: string;
  name: string;
  missionStatement: string;
  dreamStatement: string;
  qrUrl: string;
  logoUrl: string;
}

export interface DonationPanelProps {
  isAdmin: boolean;
  isDonationEditing: boolean;
  donationData: DonationData;
  bgClass: string;
  onToggleEditing: () => void;
  onStartEditing: () => void;
  onDonationDataChange: (data: DonationData) => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>, type: 'logoUrl' | 'qrUrl') => void;
  onCopySuccess: () => void;
}

export function DonationPanel({
  isAdmin,
  isDonationEditing,
  donationData,
  bgClass,
  onToggleEditing,
  onStartEditing,
  onDonationDataChange,
  onFileUpload,
  onCopySuccess,
}: DonationPanelProps) {
  return (
    <div className={`flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-8 relative min-h-screen transition-colors duration-500 ${bgClass}`}>
      {/* Master Edit Toggle */}
      {isAdmin && (
        <div className="sticky top-0 right-0 z-50 flex justify-end pb-4">
          <button
            onClick={onToggleEditing}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-xl active:scale-95 ${
              isDonationEditing
                ? 'bg-emerald-600 shadow-emerald-500/20 text-white'
                : 'bg-indigo-600 shadow-indigo-600/20 text-white'
            }`}
          >
            {isDonationEditing ? <Check className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
            {isDonationEditing ? 'Finish Editing' : 'Edit Page Content'}
          </button>
        </div>
      )}

      <div className="max-w-3xl mx-auto space-y-8 pb-12">
        {/* Hero section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[#161b22] border border-white/10 rounded-[2.5rem] p-8 sm:p-12 text-center shadow-3xl relative overflow-hidden group"
        >
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-orange-500 via-white to-green-500" />
          <div className="absolute -top-24 -right-24 w-64 h-64 bg-indigo-600/5 rounded-full blur-[80px] group-hover:bg-indigo-600/10 transition-colors" />

          <div className="relative inline-block group/edit mb-8">
            {donationData.logoUrl ? (
              <div className="relative">
                <img src={donationData.logoUrl} alt="Creator" className="w-24 h-24 rounded-3xl object-cover border-2 border-indigo-500 shadow-xl" />
                {isAdmin && isDonationEditing && (
                  <label className="absolute -bottom-2 -right-2 p-2 bg-indigo-600 rounded-xl cursor-pointer shadow-lg hover:bg-indigo-700 transition-colors">
                    <Camera className="w-3.5 h-3.5 text-white" />
                    <input type="file" className="hidden" accept="image/*" onChange={e => onFileUpload(e, 'logoUrl')} />
                  </label>
                )}
              </div>
            ) : (
              <div className="relative">
                <div className="w-20 h-20 bg-indigo-600/10 rounded-3xl flex items-center justify-center mx-auto border border-indigo-500/20 shadow-inner group-hover:rotate-12 transition-transform duration-500">
                  <HeartHandshake className="w-10 h-10 text-indigo-500" />
                </div>
                {isAdmin && isDonationEditing && (
                  <label className="absolute -bottom-2 -right-2 p-2 bg-indigo-600 rounded-xl cursor-pointer shadow-lg hover:bg-indigo-700 transition-colors">
                    <Upload className="w-3.5 h-3.5 text-white" />
                    <input type="file" className="hidden" accept="image/*" onChange={e => onFileUpload(e, 'logoUrl')} />
                  </label>
                )}
              </div>
            )}
          </div>

          <div className="relative group/edit">
            {isDonationEditing ? (
              <input
                value={donationData.headline}
                onChange={e => onDonationDataChange({ ...donationData, headline: e.target.value })}
                className="text-2xl sm:text-3xl font-black text-white mb-4 tracking-tighter leading-tight bg-white/5 border border-white/10 rounded-xl px-4 py-2 w-full text-center outline-none focus:border-indigo-500"
              />
            ) : (
              <div className="flex items-center justify-center gap-4 mb-4">
                <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tighter leading-tight">{donationData.headline}</h2>
                {isAdmin && (
                  <button onClick={onStartEditing} className="p-2 opacity-0 group-hover/edit:opacity-100 bg-white/5 hover:bg-white/10 rounded-lg text-indigo-400 transition-all border border-white/10 shadow-lg">
                    <Edit2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="relative group/edit">
            {isDonationEditing ? (
              <input
                value={donationData.subHeadline}
                onChange={e => onDonationDataChange({ ...donationData, subHeadline: e.target.value })}
                className="text-sm font-bold text-indigo-400 uppercase tracking-[0.2em] mb-8 bg-white/5 border border-white/10 rounded-xl px-4 py-2 w-full text-center outline-none focus:border-indigo-500"
              />
            ) : (
              <div className="flex items-center justify-center gap-4 mb-8">
                <p className="text-lg font-bold text-indigo-400 uppercase tracking-[0.2em]">{donationData.subHeadline}</p>
                {isAdmin && (
                  <button onClick={onStartEditing} className="p-1 px-2 opacity-0 group-hover/edit:opacity-100 bg-white/5 hover:bg-white/10 rounded-lg text-indigo-400 transition-all border border-white/10 shadow-lg flex items-center gap-1">
                    <Edit2 className="w-3 h-3" />
                    <span className="text-[8px] font-black uppercase">Edit</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="max-w-2xl mx-auto text-left space-y-6">
            <div className="relative group/edit">
              <div className="text-[#c9d1d9] text-base leading-relaxed font-medium">
                नमस्कार भारतीय भाइयों और बहनों,
                <br /><br />
                {isDonationEditing ? (
                  <div className="space-y-4">
                    <div className="flex gap-2 items-center">
                      <span className="text-[10px] text-[#8b949e] font-bold uppercase">Name:</span>
                      <input value={donationData.name} onChange={e => onDonationDataChange({ ...donationData, name: e.target.value })} className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white text-sm outline-none focus:border-indigo-500" />
                    </div>
                    <textarea value={donationData.missionStatement} onChange={e => onDonationDataChange({ ...donationData, missionStatement: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-[#c9d1d9] outline-none focus:border-indigo-500 min-h-[100px]" />
                  </div>
                ) : (
                  <div className="flex items-start gap-4">
                    <span>मैं <span className="text-white font-bold underline decoration-indigo-500 decoration-2 underline-offset-4">{donationData.name}</span> हूँ। {donationData.missionStatement}</span>
                    {isAdmin && (
                      <button onClick={onStartEditing} className="p-1 px-2 mt-1 bg-white/5 hover:bg-white/10 rounded-lg text-indigo-400 opacity-0 group-hover/edit:opacity-100 transition-all border border-white/10 shadow-lg flex items-center gap-1 shrink-0">
                        <Edit2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 bg-white/5 rounded-3xl border border-white/10 backdrop-blur-sm relative group/edit">
              {isDonationEditing ? (
                <textarea value={donationData.dreamStatement} onChange={e => onDonationDataChange({ ...donationData, dreamStatement: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-[#8b949e] italic text-center outline-none focus:border-indigo-500 min-h-[100px]" />
              ) : (
                <div className="flex flex-col items-center">
                  <p className="text-sm text-[#8b949e] leading-relaxed italic text-center">{donationData.dreamStatement}</p>
                  {isAdmin && (
                    <button onClick={onStartEditing} className="mt-4 p-1 px-2 bg-white/5 hover:bg-white/10 rounded-lg text-indigo-400 opacity-0 group-hover/edit:opacity-100 transition-all border border-white/10 shadow-lg flex items-center gap-1">
                      <Edit2 className="w-3 h-3" />
                      <span className="text-[8px] font-black uppercase">Edit Dream</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <p className="text-[#8b949e] text-sm leading-relaxed">
              मैं चाहता हूँ कि भारत भी AI की दुनिया में अपनी एक अलग पहचान बनाए — एक ऐसा AI जो भारतीय लोगों की भाषा, सोच, संस्कृति और जरूरतों को वास्तव में समझे।
            </p>

            <div className="space-y-4">
              <div className="text-xs font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                <div className="w-1 h-3 bg-indigo-500 rounded-full" />
                मिशन के लिए आवश्यक संसाधन:
              </div>
              <div className="grid grid-cols-2 gap-4">
                {['बेहतर सर्वर', 'AI ट्रेनिंग', 'रिसर्च', 'डेवलपमेंट'].map(item => (
                  <div key={item} className="flex items-center gap-2 text-xs text-white font-bold bg-white/5 p-3 rounded-xl border border-white/5">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[#c9d1d9] text-sm leading-relaxed font-medium border-l-2 border-indigo-500 pl-4 py-1">
              इसके लिए मुझे आपकी मदद की आवश्यकता है। ❤️ <br />
              यदि आपको "नवभारत AI" का सपना अच्छा लगता है, तो कृपया अपनी इच्छा अनुसार छोटा या बड़ा कोई भी सहयोग करें।
            </p>

            <p className="text-center text-indigo-300 font-bold text-sm bg-indigo-500/10 py-3 rounded-2xl border border-indigo-500/20">
              आपका छोटा सा योगदान भी इस भारतीय AI मिशन को आगे बढ़ाने में बहुत बड़ी मदद करेगा। 🙏
            </p>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* QR Code Section */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-[#161b22] border border-white/10 rounded-[2.5rem] p-8 text-center flex flex-col items-center justify-center shadow-2xl relative group"
          >
            <div className="absolute top-4 right-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <QrCode className="w-12 h-12 text-white" />
            </div>
            <h4 className="text-sm font-black text-white uppercase tracking-widest mb-6">स्कैन करके सहयोग करें</h4>
            <div className="relative group/edit">
              <div className="w-48 h-48 bg-white p-3 rounded-2xl shadow-inner relative flex items-center justify-center">
                <img
                  src={donationData.qrUrl || `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=upi://pay?pa=${donationData.upiId}&pn=${encodeURIComponent(donationData.name)}&cu=INR`}
                  alt="Donation QR Code"
                  className="w-full h-full object-contain"
                />
                {!isDonationEditing && (
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-white/80 rounded-2xl pointer-events-none text-center p-4">
                    <span className="text-[10px] font-bold text-black uppercase tracking-tight">{donationData.upiId}</span>
                  </div>
                )}
                {isDonationEditing && (
                  <label className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] text-white opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl cursor-pointer">
                    <Upload className="w-8 h-8 mb-2" />
                    <span className="text-[10px] font-black uppercase">Upload QR Code</span>
                    <input type="file" className="hidden" accept="image/*" onChange={e => onFileUpload(e, 'qrUrl')} />
                  </label>
                )}
              </div>
              {isDonationEditing && donationData.qrUrl && (
                <button onClick={() => onDonationDataChange({ ...donationData, qrUrl: '' })} className="mt-2 text-[8px] font-bold text-rose-500 uppercase flex items-center gap-1 mx-auto">
                  Reset to Auto-Generated QR
                </button>
              )}
            </div>
            <p className="text-[10px] text-[#8b949e] mt-4 font-medium italic">Supports all UPI apps (GPay, PhonePe, Paytm)</p>
          </motion.div>

          {/* UPI & CTA Section */}
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col gap-6">
            <div className="bg-[#161b22] border border-white/10 rounded-[2.5rem] p-8 shadow-2xl relative group/edit">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em]">UPI IDENTITY</h4>
                {isAdmin && !isDonationEditing && (
                  <button onClick={onStartEditing} className="p-1 px-2 bg-white/5 hover:bg-white/10 rounded-lg text-indigo-400 opacity-0 group-hover/edit:opacity-100 transition-all border border-white/10 shadow-lg flex items-center gap-1">
                    <Edit2 className="w-3 h-3" />
                    <span className="text-[8px] font-black uppercase">Edit</span>
                  </button>
                )}
              </div>
              <div className="relative group">
                <input
                  readOnly={!isDonationEditing}
                  value={donationData.upiId}
                  onChange={e => onDonationDataChange({ ...donationData, upiId: e.target.value })}
                  className={`w-full border rounded-2xl px-5 py-4 text-sm font-mono text-white outline-none transition-all shadow-inner ${
                    isDonationEditing ? 'bg-white/5 border-indigo-500/50' : 'bg-[#0d1117] border-white/10 group-hover:border-indigo-500/50'
                  }`}
                />
                {!isDonationEditing && (
                  <button
                    onClick={() => { navigator.clipboard.writeText(donationData.upiId); onCopySuccess(); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all shadow-lg active:scale-95 flex items-center gap-2 group/btn"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span className="text-[9px] font-black uppercase">Copy</span>
                  </button>
                )}
              </div>
              <p className="text-[9px] text-[#484f58] mt-3 font-medium text-center">Verify the name displayed: <span className="text-white">{donationData.name}</span></p>
            </div>

            <div className="bg-indigo-600 rounded-[2.5rem] p-8 shadow-2xl relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
              <div className="relative z-10">
                <h4 className="text-xl font-black text-white mb-2 flex items-center gap-3">
                  <Heart className="w-6 h-6 fill-rose-400 text-rose-400 animate-pulse" />
                  दिल से Donate करें
                </h4>
                <p className="text-xs text-indigo-100 font-medium leading-relaxed mb-6">
                  आपका सहयोग भारत के अपने AI को दुनिया के सबसे शानदार प्लेटफॉर्म्स में से एक बनाएगा। 🇮🇳
                </p>
                <button
                  onClick={() => window.open(`upi://pay?pa=${donationData.upiId}&pn=${encodeURIComponent(donationData.name)}&cu=INR`, '_blank')}
                  className="w-full bg-white text-indigo-600 font-black py-4 rounded-2xl text-xs uppercase tracking-widest shadow-xl hover:bg-indigo-50 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  अंकदान / Donation (UPI)
                  <ExternalLink className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-8 text-center border-t border-white/5">
          <p className="text-xs text-[#484f58] italic font-medium max-w-xl mx-auto leading-relaxed">
            "मैं वादा करता हूँ — एक दिन आपके सहयोग से नवभारत AI दुनिया के सबसे शानदार AI प्लेटफॉर्म्स में गिना जाएगा।" 🇮🇳
          </p>
        </motion.div>
      </div>
    </div>
  );
}
