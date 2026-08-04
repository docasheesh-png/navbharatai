import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Copy, Check, Star, X, Layout, Type, Square,
  LayoutGrid, FileText, Bell, Table, MousePointer,
  Navigation, Image, CreditCard, AlignLeft, Anchor,
  ChevronRight, Eye, Loader2, History, AlertTriangle, Save,
} from 'lucide-react';
import { insertSnippet, pageLoadsTailwind, snippetNeedsTailwind } from '../../lib/htmlInsert';
import { AppTargetPicker, useUserApps, useAppFiles, readAppFile, saveFilesToApp } from './AppTargetPicker';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Component {
  id: string;
  name: string;
  category: string;
  tags: string[];
  description: string;
  html: string;
}

interface ComponentLibraryProps {
  /** Preview handoff — kept so an inserted component also shows up on screen straight away. */
  onInsert?: (html: string, componentName: string) => void;
  /** The app the user is currently working on, pre-selected in the picker. */
  sessionId?: string;
}

interface CustomizerState {
  primaryColor: string;
  fontSize: 'small' | 'medium' | 'large';
  rounded: 'none' | 'small' | 'large' | 'full';
}

// ─── Categories ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'navigation', label: 'Navigation',     icon: Navigation,   count: 4 },
  { id: 'hero',       label: 'Hero Sections',  icon: Image,        count: 4 },
  { id: 'cards',      label: 'Cards',          icon: CreditCard,   count: 4 },
  { id: 'forms',      label: 'Forms',          icon: AlignLeft,    count: 4 },
  { id: 'footer',     label: 'Footer',         icon: Anchor,       count: 4 },
  { id: 'buttons',    label: 'Buttons & CTAs', icon: MousePointer, count: 4 },
  { id: 'tables',     label: 'Tables',         icon: Table,        count: 4 },
  { id: 'alerts',     label: 'Alerts & Toasts',icon: Bell,         count: 4 },
];

// ─── HTML Component Strings ───────────────────────────────────────────────────

const WRAP = (body: string) =>
  `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-gray-950 p-4 font-sans">${body}</body></html>`;

const RAW_COMPONENTS: Omit<Component, 'id'>[] = [
  // ── Navigation ─────────────────────────────────────────────────────────────
  {
    name: 'Navbar Dark', category: 'navigation', tags: ['responsive','dark','sticky'],
    description: 'Dark navbar with logo, navigation links, and a CTA button.',
    html: `<nav class="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between rounded-xl"><div class="flex items-center gap-2"><div class="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center"><span class="text-white font-bold text-sm">N</span></div><span class="text-white font-semibold text-lg">NavBharat</span></div><div class="hidden md:flex items-center gap-6"><a href="#" class="text-gray-300 hover:text-white text-sm transition">Home</a><a href="#" class="text-gray-300 hover:text-white text-sm transition">Features</a><a href="#" class="text-gray-300 hover:text-white text-sm transition">Pricing</a><a href="#" class="text-gray-300 hover:text-white text-sm transition">Docs</a></div><button class="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-2 rounded-lg transition">Get Started</button></nav>`,
  },
  {
    name: 'Sidebar Nav', category: 'navigation', tags: ['sidebar','dark','icons'],
    description: 'Vertical sidebar with icons and labels for app navigation.',
    html: `<div class="w-56 bg-gray-900 h-72 rounded-xl p-3 flex flex-col gap-1"><div class="flex items-center gap-2 px-3 py-2 mb-2"><div class="w-7 h-7 bg-indigo-600 rounded-lg"></div><span class="text-white font-semibold text-sm">MyApp</span></div><a href="#" class="flex items-center gap-3 px-3 py-2 rounded-lg bg-indigo-600/20 text-indigo-400 text-sm"><span>🏠</span>Dashboard</a><a href="#" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white text-sm transition"><span>📁</span>Projects</a><a href="#" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white text-sm transition"><span>👥</span>Team</a><a href="#" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white text-sm transition"><span>📊</span>Analytics</a><a href="#" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white text-sm transition"><span>⚙️</span>Settings</a></div>`,
  },
  {
    name: 'Tab Bar', category: 'navigation', tags: ['tabs','underline','animated'],
    description: 'Horizontal tab bar with an underline active indicator.',
    html: `<div class="bg-gray-900 rounded-xl p-4"><div class="flex border-b border-gray-800"><button class="px-4 py-2 text-sm text-indigo-400 border-b-2 border-indigo-500 -mb-px font-medium">Overview</button><button class="px-4 py-2 text-sm text-gray-400 hover:text-white transition">Analytics</button><button class="px-4 py-2 text-sm text-gray-400 hover:text-white transition">Reports</button><button class="px-4 py-2 text-sm text-gray-400 hover:text-white transition">Settings</button></div><div class="pt-4 text-gray-300 text-sm">Tab content goes here...</div></div>`,
  },
  {
    name: 'Breadcrumb', category: 'navigation', tags: ['breadcrumb','minimal'],
    description: 'Simple breadcrumb trail with chevron separators.',
    html: `<div class="bg-gray-900 rounded-xl p-4"><nav class="flex items-center gap-1 text-sm"><a href="#" class="text-gray-400 hover:text-white transition">Home</a><span class="text-gray-600">›</span><a href="#" class="text-gray-400 hover:text-white transition">Products</a><span class="text-gray-600">›</span><span class="text-white font-medium">MacBook Pro</span></nav><h2 class="text-white text-xl font-semibold mt-3">MacBook Pro</h2><p class="text-gray-400 text-sm mt-1">Apple M3 Pro chip · 18GB RAM · 512GB SSD</p></div>`,
  },

  // ── Hero ───────────────────────────────────────────────────────────────────
  {
    name: 'Hero Full', category: 'hero', tags: ['gradient','full-width','animated'],
    description: 'Full-width hero with gradient background, heading, subtext, and two CTAs.',
    html: `<section class="bg-gradient-to-br from-indigo-950 via-gray-900 to-purple-950 rounded-xl px-8 py-14 text-center"><div class="inline-flex items-center gap-2 bg-indigo-900/50 border border-indigo-700/50 rounded-full px-3 py-1 text-indigo-300 text-xs mb-6">✨ New: AI-powered builder</div><h1 class="text-white text-4xl font-extrabold leading-tight mb-4">Build Faster with<br><span class="text-indigo-400">NavBharat AI</span></h1><p class="text-gray-300 text-base max-w-sm mx-auto mb-8">Ship beautiful web apps in minutes using our AI-driven no-code platform.</p><div class="flex items-center justify-center gap-3 flex-wrap"><button class="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-medium transition">Start Free →</button><button class="border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white px-6 py-3 rounded-xl transition">See Demo</button></div></section>`,
  },
  {
    name: 'Hero Split', category: 'hero', tags: ['split','image','responsive'],
    description: 'Split layout hero: left text content, right image placeholder.',
    html: `<section class="bg-gray-900 rounded-xl p-8 flex gap-8 items-center"><div class="flex-1"><span class="text-indigo-400 text-xs font-semibold uppercase tracking-wider">Platform</span><h2 class="text-white text-3xl font-bold mt-2 mb-4">Design. Build. Launch.</h2><p class="text-gray-400 text-sm leading-relaxed mb-6">Everything you need to go from idea to production — AI co-pilot included.</p><div class="flex gap-3"><button class="bg-indigo-600 text-white px-5 py-2.5 rounded-lg text-sm hover:bg-indigo-700 transition">Get Started</button><button class="text-indigo-400 text-sm hover:text-indigo-300 transition">Learn more →</button></div></div><div class="w-52 h-36 bg-gradient-to-br from-indigo-800/40 to-purple-800/40 rounded-xl border border-indigo-700/30 flex items-center justify-center text-gray-500 text-xs flex-shrink-0">Image</div></section>`,
  },
  {
    name: 'Hero Minimal', category: 'hero', tags: ['minimal','centered','clean'],
    description: 'Centered minimal hero — text only, clean and elegant.',
    html: `<section class="bg-gray-950 rounded-xl py-16 px-8 text-center"><p class="text-indigo-400 text-sm mb-3">Hello, World 👋</p><h1 class="text-white text-4xl font-bold mb-4 tracking-tight">Less is More.</h1><p class="text-gray-500 max-w-xs mx-auto text-sm leading-relaxed">Focus on what matters. Build with clarity and purpose.</p><button class="mt-8 text-sm text-indigo-400 border border-indigo-700 px-5 py-2 rounded-full hover:bg-indigo-900/30 transition">Explore →</button></section>`,
  },
  {
    name: 'Hero Video BG', category: 'hero', tags: ['video','overlay','bold'],
    description: 'Hero section styled for a dark video background with overlay.',
    html: `<section class="relative bg-gray-950 rounded-xl overflow-hidden"><div class="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/70 to-transparent z-10"></div><div class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/30 via-transparent to-transparent"></div><div class="relative z-20 py-16 px-8 text-center"><span class="inline-block bg-red-600 text-white text-xs px-3 py-0.5 rounded-full mb-4 font-medium">LIVE</span><h1 class="text-white text-4xl font-extrabold mb-4">Streaming Now</h1><p class="text-gray-400 text-sm mb-8">Watch the future being built, live.</p><button class="bg-white text-gray-900 font-semibold px-8 py-3 rounded-xl hover:bg-gray-100 transition">▶ Watch Now</button></div></section>`,
  },

  // ── Cards ──────────────────────────────────────────────────────────────────
  {
    name: 'Product Card', category: 'cards', tags: ['product','ecommerce','button'],
    description: 'E-commerce product card with image, title, price, and buy button.',
    html: `<div class="bg-gray-800 rounded-2xl overflow-hidden w-48 shadow-lg"><div class="h-28 bg-gradient-to-br from-indigo-900 to-purple-900 flex items-center justify-center text-3xl">📦</div><div class="p-4"><h3 class="text-white font-semibold text-sm">Premium Widget</h3><p class="text-gray-400 text-xs mt-1">Quality craftsmanship</p><div class="flex items-center justify-between mt-3"><span class="text-indigo-400 font-bold text-base">₹999</span><button class="bg-indigo-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition">Buy Now</button></div></div></div>`,
  },
  {
    name: 'Profile Card', category: 'cards', tags: ['profile','avatar','social'],
    description: 'User profile card with avatar, name, role, and social links.',
    html: `<div class="bg-gray-800 rounded-2xl p-6 w-52 text-center shadow-lg"><div class="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-2xl font-bold mx-auto mb-3">A</div><h3 class="text-white font-semibold">Aarav Shah</h3><p class="text-indigo-400 text-xs mt-1">Full-Stack Developer</p><p class="text-gray-500 text-xs mt-2">Building cool things at NavBharat</p><div class="flex justify-center gap-3 mt-4"><a href="#" class="text-gray-400 hover:text-white text-xs transition">𝕏</a><a href="#" class="text-gray-400 hover:text-white text-xs transition">in</a><a href="#" class="text-gray-400 hover:text-white text-xs transition">gh</a></div></div>`,
  },
  {
    name: 'Stats Card', category: 'cards', tags: ['stats','metrics','trend'],
    description: 'Metric stats card with a number, label, and trend indicator.',
    html: `<div class="bg-gray-800 rounded-2xl p-5 w-44 shadow-lg"><div class="flex items-start justify-between mb-3"><div class="w-10 h-10 bg-indigo-600/20 rounded-xl flex items-center justify-center text-indigo-400 text-lg">📈</div><span class="text-green-400 text-xs font-medium bg-green-400/10 px-2 py-0.5 rounded-full">+12%</span></div><div class="text-3xl font-bold text-white">4,281</div><div class="text-gray-400 text-xs mt-1">Active Users</div><div class="mt-3 h-1 bg-gray-700 rounded-full"><div class="h-1 bg-indigo-500 rounded-full w-3/4"></div></div></div>`,
  },
  {
    name: 'Blog Card', category: 'cards', tags: ['blog','article','image'],
    description: 'Blog post card with image, date, title, excerpt, and read more link.',
    html: `<div class="bg-gray-800 rounded-2xl overflow-hidden w-56 shadow-lg"><div class="h-28 bg-gradient-to-br from-blue-900 to-indigo-900 flex items-center justify-center text-3xl">📝</div><div class="p-4"><span class="text-indigo-400 text-xs">June 10, 2026</span><h3 class="text-white font-semibold text-sm mt-1 leading-snug">How AI is Changing Web Dev</h3><p class="text-gray-400 text-xs mt-2 leading-relaxed line-clamp-2">Discover how modern AI tools can speed up your entire development workflow...</p><a href="#" class="text-indigo-400 text-xs mt-3 inline-block hover:text-indigo-300 transition">Read More →</a></div></div>`,
  },

  // ── Forms ──────────────────────────────────────────────────────────────────
  {
    name: 'Login Form', category: 'forms', tags: ['login','auth','card'],
    description: 'Card-style login form with email, password fields and submit button.',
    html: `<div class="bg-gray-800 rounded-2xl p-6 w-72 shadow-xl"><h2 class="text-white font-bold text-lg mb-1">Welcome back</h2><p class="text-gray-400 text-xs mb-5">Sign in to your account</p><div class="space-y-3"><div><label class="text-gray-400 text-xs mb-1 block">Email</label><input type="email" placeholder="you@example.com" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500"/></div><div><label class="text-gray-400 text-xs mb-1 block">Password</label><input type="password" placeholder="••••••••" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500"/></div></div><button class="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-sm font-medium mt-5 transition">Sign In</button><p class="text-center text-gray-500 text-xs mt-3">Don't have an account? <a href="#" class="text-indigo-400">Sign up</a></p></div>`,
  },
  {
    name: 'Signup Form', category: 'forms', tags: ['signup','register','auth'],
    description: 'Registration form with name, email, and password fields.',
    html: `<div class="bg-gray-800 rounded-2xl p-6 w-72 shadow-xl"><h2 class="text-white font-bold text-lg mb-1">Create account</h2><p class="text-gray-400 text-xs mb-5">Start building for free</p><div class="space-y-3"><div><label class="text-gray-400 text-xs mb-1 block">Full Name</label><input type="text" placeholder="Aarav Shah" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500"/></div><div><label class="text-gray-400 text-xs mb-1 block">Email</label><input type="email" placeholder="you@example.com" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500"/></div><div><label class="text-gray-400 text-xs mb-1 block">Password</label><input type="password" placeholder="••••••••" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500"/></div></div><button class="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-sm font-medium mt-5 transition">Create Account</button></div>`,
  },
  {
    name: 'Contact Form', category: 'forms', tags: ['contact','message','textarea'],
    description: 'Contact form with name, email, message, and submit.',
    html: `<div class="bg-gray-800 rounded-2xl p-6 w-72 shadow-xl"><h2 class="text-white font-bold text-lg mb-1">Get in Touch</h2><p class="text-gray-400 text-xs mb-5">We'll reply within 24 hours</p><div class="space-y-3"><input type="text" placeholder="Your name" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500"/><input type="email" placeholder="your@email.com" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500"/><textarea placeholder="Your message..." rows="3" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"></textarea></div><button class="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-sm font-medium mt-4 transition">Send Message</button></div>`,
  },
  {
    name: 'Newsletter', category: 'forms', tags: ['newsletter','email','subscribe'],
    description: 'Inline newsletter subscription with email input and subscribe button.',
    html: `<div class="bg-gradient-to-r from-indigo-900 to-purple-900 rounded-2xl p-6 text-center w-72"><h3 class="text-white font-bold text-base mb-1">Stay in the Loop</h3><p class="text-indigo-200 text-xs mb-4">Get the latest updates delivered to your inbox.</p><div class="flex gap-2"><input type="email" placeholder="Enter your email" class="flex-1 bg-white/10 border border-indigo-600/50 rounded-lg px-3 py-2 text-white text-sm placeholder-indigo-300/60 focus:outline-none focus:border-indigo-400"/><button class="bg-white text-indigo-700 font-semibold text-xs px-4 py-2 rounded-lg hover:bg-indigo-50 transition whitespace-nowrap">Subscribe</button></div><p class="text-indigo-300/60 text-xs mt-2">No spam. Unsubscribe anytime.</p></div>`,
  },

  // ── Footer ─────────────────────────────────────────────────────────────────
  {
    name: 'Footer Simple', category: 'footer', tags: ['footer','minimal','links'],
    description: 'Simple footer with logo, links, and copyright.',
    html: `<footer class="bg-gray-900 rounded-xl px-6 py-5"><div class="flex flex-col md:flex-row items-center justify-between gap-4"><div class="flex items-center gap-2"><div class="w-6 h-6 bg-indigo-600 rounded-md"></div><span class="text-white font-semibold text-sm">NavBharat</span></div><div class="flex gap-5"><a href="#" class="text-gray-400 hover:text-white text-xs transition">Privacy</a><a href="#" class="text-gray-400 hover:text-white text-xs transition">Terms</a><a href="#" class="text-gray-400 hover:text-white text-xs transition">Contact</a><a href="#" class="text-gray-400 hover:text-white text-xs transition">Blog</a></div><p class="text-gray-500 text-xs">© 2026 NavBharat. All rights reserved.</p></div></footer>`,
  },
  {
    name: 'Footer Multi-column', category: 'footer', tags: ['footer','columns','links'],
    description: 'Multi-column footer with product, company, and support sections.',
    html: `<footer class="bg-gray-900 rounded-xl px-6 py-8"><div class="grid grid-cols-3 gap-6 mb-6"><div><h4 class="text-white font-semibold text-sm mb-3">Product</h4><div class="space-y-2"><a href="#" class="block text-gray-400 hover:text-white text-xs transition">Features</a><a href="#" class="block text-gray-400 hover:text-white text-xs transition">Pricing</a><a href="#" class="block text-gray-400 hover:text-white text-xs transition">Changelog</a></div></div><div><h4 class="text-white font-semibold text-sm mb-3">Company</h4><div class="space-y-2"><a href="#" class="block text-gray-400 hover:text-white text-xs transition">About</a><a href="#" class="block text-gray-400 hover:text-white text-xs transition">Blog</a><a href="#" class="block text-gray-400 hover:text-white text-xs transition">Careers</a></div></div><div><h4 class="text-white font-semibold text-sm mb-3">Support</h4><div class="space-y-2"><a href="#" class="block text-gray-400 hover:text-white text-xs transition">Docs</a><a href="#" class="block text-gray-400 hover:text-white text-xs transition">Community</a><a href="#" class="block text-gray-400 hover:text-white text-xs transition">Status</a></div></div></div><div class="border-t border-gray-800 pt-4 flex justify-between items-center"><span class="text-white font-semibold text-sm">NavBharat</span><p class="text-gray-500 text-xs">© 2026 All rights reserved.</p></div></footer>`,
  },
  {
    name: 'Footer Dark', category: 'footer', tags: ['footer','dark','brand'],
    description: 'Bold dark footer with tagline and social icons.',
    html: `<footer class="bg-gray-950 border-t border-gray-800 rounded-xl px-6 py-8 text-center"><div class="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-lg mx-auto mb-3">N</div><p class="text-white font-semibold text-sm mb-1">NavBharat AI</p><p class="text-gray-500 text-xs mb-5">Build the web. Faster.</p><div class="flex justify-center gap-4 mb-5"><a href="#" class="w-8 h-8 bg-gray-800 hover:bg-gray-700 rounded-lg flex items-center justify-center text-gray-400 hover:text-white text-xs transition">𝕏</a><a href="#" class="w-8 h-8 bg-gray-800 hover:bg-gray-700 rounded-lg flex items-center justify-center text-gray-400 hover:text-white text-xs transition">in</a><a href="#" class="w-8 h-8 bg-gray-800 hover:bg-gray-700 rounded-lg flex items-center justify-center text-gray-400 hover:text-white text-xs transition">gh</a></div><p class="text-gray-600 text-xs">© 2026 NavBharat Technologies.</p></footer>`,
  },
  {
    name: 'Footer Minimal', category: 'footer', tags: ['footer','one-line','clean'],
    description: 'One-line minimal footer — just the essentials.',
    html: `<footer class="bg-gray-900 rounded-xl px-6 py-4 flex items-center justify-between"><span class="text-gray-500 text-xs">© 2026 NavBharat</span><div class="flex gap-4"><a href="#" class="text-gray-500 hover:text-white text-xs transition">Privacy</a><a href="#" class="text-gray-500 hover:text-white text-xs transition">Terms</a></div></footer>`,
  },

  // ── Buttons ────────────────────────────────────────────────────────────────
  {
    name: 'Button Primary', category: 'buttons', tags: ['button','primary','cta'],
    description: 'Standard primary action button variants.',
    html: `<div class="bg-gray-900 rounded-xl p-6 flex flex-wrap gap-3 items-center"><button class="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition">Primary</button><button class="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition">Purple</button><button class="bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition">Success</button><button class="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition">Danger</button><button class="bg-gray-700 hover:bg-gray-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition">Secondary</button></div>`,
  },
  {
    name: 'Button Ghost', category: 'buttons', tags: ['button','ghost','outline'],
    description: 'Ghost/outline button variants for secondary actions.',
    html: `<div class="bg-gray-900 rounded-xl p-6 flex flex-wrap gap-3 items-center"><button class="border border-indigo-600 text-indigo-400 hover:bg-indigo-600 hover:text-white px-5 py-2.5 rounded-lg text-sm font-medium transition">Outline</button><button class="border border-gray-600 text-gray-300 hover:border-gray-400 hover:text-white px-5 py-2.5 rounded-lg text-sm font-medium transition">Ghost</button><button class="text-indigo-400 hover:text-indigo-300 px-5 py-2.5 text-sm font-medium transition">Link →</button><button class="border border-dashed border-gray-600 text-gray-400 hover:border-indigo-500 hover:text-indigo-400 px-5 py-2.5 rounded-lg text-sm font-medium transition">Dashed</button></div>`,
  },
  {
    name: 'Button Gradient', category: 'buttons', tags: ['button','gradient','glow'],
    description: 'Eye-catching gradient CTA buttons with glow effects.',
    html: `<div class="bg-gray-900 rounded-xl p-6 flex flex-wrap gap-4 items-center"><button class="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-6 py-2.5 rounded-xl text-sm font-medium transition shadow-lg shadow-indigo-900/50">Gradient CTA</button><button class="bg-gradient-to-r from-cyan-500 to-blue-500 text-white px-6 py-2.5 rounded-xl text-sm font-medium transition shadow-lg shadow-blue-900/50">Ocean</button><button class="bg-gradient-to-r from-orange-500 to-pink-500 text-white px-6 py-2.5 rounded-xl text-sm font-medium transition shadow-lg shadow-pink-900/50">Sunset</button></div>`,
  },
  {
    name: 'Button Icon', category: 'buttons', tags: ['button','icon','action'],
    description: 'Icon buttons and icon+label button combinations.',
    html: `<div class="bg-gray-900 rounded-xl p-6 flex flex-wrap gap-3 items-center"><button class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition flex items-center gap-2">⬇ Download</button><button class="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition flex items-center gap-2">⚙ Settings</button><button class="w-10 h-10 bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-600/40 text-indigo-400 hover:text-white rounded-lg transition flex items-center justify-center text-base">+</button><button class="w-10 h-10 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded-lg transition flex items-center justify-center text-base">🔔</button></div>`,
  },

  // ── Tables ─────────────────────────────────────────────────────────────────
  {
    name: 'Table Simple', category: 'tables', tags: ['table','data','simple'],
    description: 'Clean simple data table with header and rows.',
    html: `<div class="bg-gray-900 rounded-xl overflow-hidden"><table class="w-full text-sm"><thead><tr class="border-b border-gray-800"><th class="text-left text-gray-400 font-medium px-4 py-3">Name</th><th class="text-left text-gray-400 font-medium px-4 py-3">Role</th><th class="text-left text-gray-400 font-medium px-4 py-3">Status</th></tr></thead><tbody><tr class="border-b border-gray-800/50"><td class="px-4 py-3 text-white">Aarav Shah</td><td class="px-4 py-3 text-gray-400">Developer</td><td class="px-4 py-3"><span class="text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full text-xs">Active</span></td></tr><tr class="border-b border-gray-800/50"><td class="px-4 py-3 text-white">Priya Nair</td><td class="px-4 py-3 text-gray-400">Designer</td><td class="px-4 py-3"><span class="text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full text-xs">Pending</span></td></tr><tr><td class="px-4 py-3 text-white">Rohan Mehta</td><td class="px-4 py-3 text-gray-400">Manager</td><td class="px-4 py-3"><span class="text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full text-xs">Online</span></td></tr></tbody></table></div>`,
  },
  {
    name: 'Table Striped', category: 'tables', tags: ['table','striped','zebra'],
    description: 'Striped zebra table for improved row readability.',
    html: `<div class="bg-gray-900 rounded-xl overflow-hidden"><table class="w-full text-sm"><thead><tr class="bg-indigo-900/30"><th class="text-left text-indigo-300 font-medium px-4 py-3">Product</th><th class="text-left text-indigo-300 font-medium px-4 py-3">Sales</th><th class="text-left text-indigo-300 font-medium px-4 py-3">Revenue</th></tr></thead><tbody><tr class="bg-gray-800/30"><td class="px-4 py-3 text-white">Widget Pro</td><td class="px-4 py-3 text-gray-300">1,230</td><td class="px-4 py-3 text-green-400">₹1.2L</td></tr><tr><td class="px-4 py-3 text-white">App Starter</td><td class="px-4 py-3 text-gray-300">845</td><td class="px-4 py-3 text-green-400">₹84.5K</td></tr><tr class="bg-gray-800/30"><td class="px-4 py-3 text-white">AI Bundle</td><td class="px-4 py-3 text-gray-300">2,100</td><td class="px-4 py-3 text-green-400">₹4.2L</td></tr></tbody></table></div>`,
  },
  {
    name: 'Table Sortable', category: 'tables', tags: ['table','sortable','interactive'],
    description: 'Table with sort indicators on column headers.',
    html: `<div class="bg-gray-900 rounded-xl overflow-hidden"><table class="w-full text-sm"><thead><tr class="border-b border-gray-700"><th class="text-left px-4 py-3 cursor-pointer hover:bg-gray-800 transition group"><span class="text-gray-300 font-medium flex items-center gap-1">Name <span class="text-gray-600 group-hover:text-gray-400">↕</span></span></th><th class="text-left px-4 py-3 cursor-pointer hover:bg-gray-800 transition group"><span class="text-gray-300 font-medium flex items-center gap-1">Score <span class="text-indigo-400">↑</span></span></th><th class="text-left px-4 py-3 cursor-pointer hover:bg-gray-800 transition group"><span class="text-gray-300 font-medium flex items-center gap-1">Date <span class="text-gray-600 group-hover:text-gray-400">↕</span></span></th></tr></thead><tbody><tr class="border-b border-gray-800 hover:bg-gray-800/50 transition"><td class="px-4 py-3 text-white">Alpha</td><td class="px-4 py-3 text-indigo-300">98</td><td class="px-4 py-3 text-gray-400">Jun 10</td></tr><tr class="border-b border-gray-800 hover:bg-gray-800/50 transition"><td class="px-4 py-3 text-white">Beta</td><td class="px-4 py-3 text-indigo-300">74</td><td class="px-4 py-3 text-gray-400">Jun 8</td></tr><tr class="hover:bg-gray-800/50 transition"><td class="px-4 py-3 text-white">Gamma</td><td class="px-4 py-3 text-indigo-300">61</td><td class="px-4 py-3 text-gray-400">Jun 5</td></tr></tbody></table></div>`,
  },
  {
    name: 'Table Dark', category: 'tables', tags: ['table','dark','compact'],
    description: 'Compact dark table with action buttons per row.',
    html: `<div class="bg-gray-950 rounded-xl overflow-hidden border border-gray-800"><table class="w-full text-sm"><thead><tr class="bg-gray-900"><th class="text-left text-gray-500 font-medium px-4 py-2.5 uppercase text-xs tracking-wider">User</th><th class="text-left text-gray-500 font-medium px-4 py-2.5 uppercase text-xs tracking-wider">Plan</th><th class="text-right text-gray-500 font-medium px-4 py-2.5 uppercase text-xs tracking-wider">Action</th></tr></thead><tbody><tr class="border-t border-gray-800 hover:bg-gray-900/50 transition"><td class="px-4 py-3 text-white text-xs">user@example.com</td><td class="px-4 py-3"><span class="bg-indigo-600 text-white text-xs px-2 py-0.5 rounded">Pro</span></td><td class="px-4 py-3 text-right"><button class="text-gray-400 hover:text-white text-xs transition">Edit</button></td></tr><tr class="border-t border-gray-800 hover:bg-gray-900/50 transition"><td class="px-4 py-3 text-white text-xs">admin@company.in</td><td class="px-4 py-3"><span class="bg-yellow-600 text-white text-xs px-2 py-0.5 rounded">Free</span></td><td class="px-4 py-3 text-right"><button class="text-gray-400 hover:text-white text-xs transition">Edit</button></td></tr></tbody></table></div>`,
  },

  // ── Alerts ─────────────────────────────────────────────────────────────────
  {
    name: 'Alert Success', category: 'alerts', tags: ['alert','success','green'],
    description: 'Success state alert banner with an icon and message.',
    html: `<div class="space-y-3 p-2"><div class="flex items-start gap-3 bg-green-900/30 border border-green-700/50 rounded-xl px-4 py-3"><span class="text-green-400 mt-0.5">✓</span><div><p class="text-green-300 font-medium text-sm">Operation Successful</p><p class="text-green-400/70 text-xs mt-0.5">Your changes have been saved successfully.</p></div></div><div class="flex items-center gap-3 bg-green-900/20 border border-green-800/40 rounded-lg px-4 py-2.5"><div class="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div><p class="text-green-300 text-sm flex-1">Profile updated successfully!</p><button class="text-green-500 hover:text-green-300 text-lg leading-none">×</button></div></div>`,
  },
  {
    name: 'Alert Error', category: 'alerts', tags: ['alert','error','red'],
    description: 'Error/danger alert with descriptive message.',
    html: `<div class="space-y-3 p-2"><div class="flex items-start gap-3 bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3"><span class="text-red-400 mt-0.5">✕</span><div><p class="text-red-300 font-medium text-sm">Error Occurred</p><p class="text-red-400/70 text-xs mt-0.5">Failed to save changes. Please try again.</p></div></div><div class="flex items-center gap-3 bg-red-900/20 border border-red-800/40 rounded-lg px-4 py-2.5"><div class="w-2 h-2 bg-red-500 rounded-full flex-shrink-0"></div><p class="text-red-300 text-sm flex-1">Something went wrong. Please try again.</p><button class="text-red-500 hover:text-red-300 text-lg leading-none">×</button></div></div>`,
  },
  {
    name: 'Alert Warning', category: 'alerts', tags: ['alert','warning','yellow'],
    description: 'Warning alert for cautionary messages.',
    html: `<div class="space-y-3 p-2"><div class="flex items-start gap-3 bg-yellow-900/20 border border-yellow-700/40 rounded-xl px-4 py-3"><span class="text-yellow-400 mt-0.5">⚠</span><div><p class="text-yellow-300 font-medium text-sm">Heads Up!</p><p class="text-yellow-400/70 text-xs mt-0.5">Your account is nearing its usage limit.</p></div><button class="ml-auto text-yellow-600 hover:text-yellow-400 text-xs transition">Upgrade</button></div><div class="bg-yellow-900/10 border border-yellow-800/30 rounded-lg px-4 py-3"><p class="text-yellow-300 text-xs">⚡ Free plan: 7 days remaining. Upgrade to continue.</p></div></div>`,
  },
  {
    name: 'Alert Info', category: 'alerts', tags: ['alert','info','blue','toast'],
    description: 'Informational alert and toast notification variants.',
    html: `<div class="space-y-3 p-2"><div class="flex items-start gap-3 bg-blue-900/20 border border-blue-700/40 rounded-xl px-4 py-3"><span class="text-blue-400 mt-0.5">ℹ</span><div><p class="text-blue-300 font-medium text-sm">New Update Available</p><p class="text-blue-400/70 text-xs mt-0.5">Version 2.1.0 is ready to install.</p></div><button class="ml-auto bg-blue-600 text-white text-xs px-3 py-1 rounded-lg hover:bg-blue-700 transition flex-shrink-0">Update</button></div><div class="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 shadow-xl"><div class="w-8 h-8 bg-indigo-600/20 rounded-lg flex items-center justify-center text-indigo-400 flex-shrink-0">🔔</div><p class="text-white text-xs flex-1">Aarav commented on your project</p><span class="text-gray-500 text-xs">2m ago</span></div></div>`,
  },
];

// Attach IDs
const COMPONENTS: Component[] = RAW_COMPONENTS.map((c, i) => ({ ...c, id: `comp_${i}` }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const buildSrcdoc = (html: string, customizer?: CustomizerState): string => {
  let styleInject = '';
  if (customizer) {
    const fsMap = { small: '12px', medium: '14px', large: '16px' };
    const rMap = { none: '0px', small: '4px', large: '12px', full: '9999px' };
    styleInject = `<style>
      :root { --primary: ${customizer.primaryColor}; }
      body { font-size: ${fsMap[customizer.fontSize]}; }
      button, input, .rounded-xl, .rounded-lg, .rounded-2xl {
        border-radius: ${rMap[customizer.rounded]} !important;
      }
      .bg-indigo-600, .bg-indigo-500 { background-color: ${customizer.primaryColor} !important; }
      .text-indigo-400, .text-indigo-300 { color: ${customizer.primaryColor} !important; }
      .border-indigo-600, .border-indigo-500 { border-color: ${customizer.primaryColor} !important; }
    </style>`;
  }
  return WRAP(styleInject + html);
};

const FAV_KEY = 'navbharatai_fav_components';
const loadFavs = (): string[] => {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; }
};
const saveFavs = (ids: string[]) => localStorage.setItem(FAV_KEY, JSON.stringify(ids));

// ─── CDN Library Catalog ──────────────────────────────────────────────────────

interface CdnLib {
  id: string;
  name: string;
  description: string;
  tag: string;
  category: string;
  size: string;
  scriptTag: string;
}

const CDN_LIBRARIES: CdnLib[] = [
  { id: 'chartjs', name: 'Chart.js', description: 'Beautiful animated charts', tag: 'Charts', category: 'Data', size: '60kb', scriptTag: '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>' },
  { id: 'gsap', name: 'GSAP', description: 'Professional-grade animations', tag: 'Animation', category: 'UI', size: '67kb', scriptTag: '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>' },
  { id: 'threejs', name: 'Three.js', description: '3D graphics in the browser', tag: '3D', category: 'Graphics', size: '577kb', scriptTag: '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js"></script>' },
  { id: 'aos', name: 'AOS', description: 'Animate On Scroll effects', tag: 'Animation', category: 'UI', size: '14kb', scriptTag: '<link rel="stylesheet" href="https://unpkg.com/aos@2.3.1/dist/aos.css"><script src="https://unpkg.com/aos@2.3.1/dist/aos.js"></script><script>document.addEventListener("DOMContentLoaded",()=>AOS.init())</script>' },
  { id: 'sweetalert2', name: 'SweetAlert2', description: 'Beautiful custom alert dialogs', tag: 'UI', category: 'UI', size: '42kb', scriptTag: '<script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>' },
  { id: 'sortable', name: 'SortableJS', description: 'Drag-and-drop sortable lists', tag: 'Interaction', category: 'UI', size: '25kb', scriptTag: '<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js"></script>' },
  { id: 'dayjs', name: 'Day.js', description: 'Lightweight date/time library', tag: 'Utils', category: 'Utility', size: '2kb', scriptTag: '<script src="https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js"></script>' },
  { id: 'lodash', name: 'Lodash', description: 'Utility functions for arrays/objects', tag: 'Utils', category: 'Utility', size: '24kb', scriptTag: '<script src="https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js"></script>' },
  { id: 'particles', name: 'Particles.js', description: 'Particle animation backgrounds', tag: 'Animation', category: 'UI', size: '28kb', scriptTag: '<script src="https://cdn.jsdelivr.net/particles.js/2.0.0/particles.min.js"></script>' },
  { id: 'howler', name: 'Howler.js', description: 'Web audio library for games', tag: 'Audio', category: 'Media', size: '21kb', scriptTag: '<script src="https://cdnjs.cloudflare.com/ajax/libs/howler/2.2.4/howler.min.js"></script>' },
  { id: 'qrcode', name: 'QRCode.js', description: 'Generate QR codes client-side', tag: 'Utils', category: 'Utility', size: '12kb', scriptTag: '<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>' },
  { id: 'pdfmake', name: 'pdfmake', description: 'PDF generation in the browser', tag: 'Export', category: 'Utility', size: '490kb', scriptTag: '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.12/pdfmake.min.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.12/vfs_fonts.js"></script>' },
  { id: 'socket', name: 'Socket.io', description: 'Real-time WebSocket communication', tag: 'Network', category: 'Network', size: '44kb', scriptTag: '<script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>' },
  { id: 'leaflet', name: 'Leaflet.js', description: 'Interactive maps', tag: 'Maps', category: 'Data', size: '39kb', scriptTag: '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>' },
  { id: 'typed', name: 'Typed.js', description: 'Typewriter animation effects', tag: 'Animation', category: 'UI', size: '11kb', scriptTag: '<script src="https://cdn.jsdelivr.net/npm/typed.js@2.1.0/dist/typed.umd.js"></script>' },
];

// ─── ComponentLibrary ─────────────────────────────────────────────────────────

export const ComponentLibrary: React.FC<ComponentLibraryProps> = ({ onInsert, sessionId }) => {
  const [activeTab, setActiveTab] = useState<'components' | 'libraries'>('components');
  const [libSearch, setLibSearch] = useState('');
  const [libCopied, setLibCopied] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('navigation');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Component | null>(null);
  const [modalComp, setModalComp] = useState<Component | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [favs, setFavs] = useState<string[]>(loadFavs);
  const [customizer, setCustomizer] = useState<CustomizerState>({
    primaryColor: '#6366f1',
    fontSize: 'medium',
    rounded: 'large',
  });

  // Adding a component to the user's REAL app (admin 2026-07-27). "Insert" used to merge the snippet
  // into the in-memory preview only, so it was gone the moment the tab closed.
  const { apps, loading: appsLoading, selected: targetSession, setSelected: setTargetSession } = useUserApps(sessionId);
  const { files: appFiles, loading: filesLoading, reload: reloadFiles } = useAppFiles(targetSession);
  const [targetPath, setTargetPath] = useState('');
  const [inserting, setInserting] = useState('');
  const [insertNote, setInsertNote] = useState('');
  const [insertFailed, setInsertFailed] = useState(false);
  const [mobilePicker, setMobilePicker] = useState(false);

  // Default to the app's main page — where a component almost always belongs.
  useEffect(() => {
    if (targetPath && appFiles.some((f) => f.path === targetPath)) return;
    const pages = appFiles.filter((f) => f.writable && /\.html?$/i.test(f.path)).map((f) => f.path);
    setTargetPath(pages.find((p) => /(^|\/)index\.html?$/i.test(p)) || pages[0] || '');
  }, [appFiles, targetPath]);

  /**
   * Add a snippet to the chosen page of the chosen app, for real.
   *
   * The page is re-read first so the snippet lands in its CURRENT content. A library tag that is
   * already loaded is reported as such rather than added a second time, and a Tailwind-based
   * component going into a page without Tailwind says so instead of quietly rendering unstyled.
   */
  const addToApp = useCallback(async (snippet: string, name: string, key: string) => {
    if (!targetSession || !targetPath || inserting) return;
    setInserting(key);
    setInsertNote('');
    setInsertFailed(false);
    try {
      const current = await readAppFile(targetSession, targetPath);
      if (current === null) {
        setInsertFailed(true);
        setInsertNote('Could not open that page, so nothing was changed.');
        return;
      }
      const result = insertSnippet(targetPath, current, snippet);
      if (!result.ok) {
        setInsertFailed(true);
        setInsertNote(result.error || 'That file cannot take a component.');
        return;
      }
      if (result.skipped) {
        setInsertNote(`${name} is already loaded on that page — nothing was added.`);
        return;
      }

      const outcome = await saveFilesToApp(
        targetSession,
        { [targetPath]: result.code },
        `Before adding ${name} to ${targetPath}`,
      );
      if (!outcome.ok) {
        setInsertFailed(true);
        setInsertNote(outcome.error || 'Could not save. Your app is unchanged.');
        return;
      }
      const needsTailwind = snippetNeedsTailwind(snippet) && !pageLoadsTailwind(result.code);
      setInsertNote(
        `${name} added to ${targetPath}.${needsTailwind
          ? ' Note: this component is styled with Tailwind classes and that page does not load Tailwind, so it will look unstyled until you add it.'
          : ''} ${outcome.undoHint || ''}`.trim(),
      );
      void reloadFiles(targetSession);
      onInsert?.(snippet, name);
    } catch {
      setInsertFailed(true);
      setInsertNote('Could not reach the server. Your app is unchanged.');
    } finally {
      setInserting('');
    }
  }, [targetSession, targetPath, inserting, onInsert, reloadFiles]);

  const canInsert = !!targetSession && !!targetPath;

  // Sync favs to localStorage
  useEffect(() => { saveFavs(favs); }, [favs]);

  // Auto-select first component in category
  useEffect(() => {
    const first = COMPONENTS.find(c => c.category === activeCategory);
    if (first) setSelected(first);
  }, [activeCategory]);

  const toggleFav = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavs(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  }, []);

  const copyToClipboard = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }, []);

  const filteredComponents = COMPONENTS.filter(c => {
    const matchCat = c.category === activeCategory;
    const q = search.toLowerCase();
    const matchSearch = !q || c.name.toLowerCase().includes(q) || c.tags.some(t => t.includes(q));
    return matchCat && matchSearch;
  });

  const filteredLibs = CDN_LIBRARIES.filter(l => {
    const q = libSearch.toLowerCase();
    return !q || l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q) || l.tag.toLowerCase().includes(q);
  });

  const copyLibTag = (lib: CdnLib) => {
    navigator.clipboard.writeText(lib.scriptTag).then(() => {
      setLibCopied(lib.id);
      setTimeout(() => setLibCopied(null), 2000);
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#0d1117', color: '#e6edf3' }}>
      {/* ── Tab Bar ── */}
      <div className="flex-shrink-0 flex items-center gap-1 px-4 py-2 border-b border-gray-800 bg-[#161b22]">
        {([['components', '🧩 Components'], ['libraries', '📦 CDN Libraries']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === id
                ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'libraries' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-shrink-0 px-4 py-3 border-b border-gray-800">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={libSearch}
                onChange={e => setLibSearch(e.target.value)}
                placeholder="Search libraries..."
                className="w-full pl-9 pr-4 py-2 rounded-lg text-xs outline-none"
                style={{ background: '#161b22', border: '1px solid #30363d', color: '#e6edf3' }}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 gap-3">
            {filteredLibs.map(lib => (
              <div key={lib.id} className="bg-[#161b22] border border-gray-800 rounded-xl p-4 hover:border-indigo-500/40 transition-all group">
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <span className="text-sm font-bold text-white">{lib.name}</span>
                    <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-600/20 text-indigo-400 font-bold uppercase tracking-wider">{lib.tag}</span>
                    <span className="ml-1 text-[9px] text-gray-600 font-mono">{lib.size}</span>
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mb-3">{lib.description}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => copyLibTag(lib)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/30 text-indigo-300 text-[10px] font-bold rounded-lg transition-all"
                  >
                    {libCopied === lib.id ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    {libCopied === lib.id ? 'Copied!' : 'Copy Tag'}
                  </button>
                  <button
                    onClick={() => void addToApp(lib.scriptTag, lib.name, 'lib_' + lib.id)}
                    disabled={!canInsert || !!inserting}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/15 hover:bg-emerald-600/30 border border-emerald-500/25 text-emerald-400 text-[10px] font-bold rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {inserting === 'lib_' + lib.id ? <Loader2 size={11} className="animate-spin" /> : null}
                    Add to my app
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Where does "Add to my app" put things? Answering this once, at the top, is what turns
             every button below from a preview trick into a real change. ── */}
      <div className="flex-shrink-0 border-b border-gray-800" style={{ background: '#0d1117' }}>
        <button
          onClick={() => setMobilePicker(v => !v)}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-left md:hidden"
        >
          <Save size={13} className="text-indigo-400 flex-shrink-0" />
          <span className="flex-1 min-w-0 text-xs text-gray-300 truncate">
            {canInsert ? <>Adding to <span className="text-indigo-300">{targetPath}</span></> : 'Choose where to add components'}
          </span>
          <ChevronRight size={13} className={`text-gray-500 transition-transform ${mobilePicker ? 'rotate-90' : ''}`} />
        </button>
        <div className={`${mobilePicker ? 'block' : 'hidden'} md:block`}>
          <AppTargetPicker
            apps={apps}
            appsLoading={appsLoading}
            files={appFiles}
            filesLoading={filesLoading}
            sessionId={targetSession}
            onSessionChange={(sid) => { setTargetSession(sid); setTargetPath(''); setInsertNote(''); }}
            selectedPath={targetPath}
            onPathChange={(pth) => { setTargetPath(pth); setInsertNote(''); }}
            fileFilter={(f) => /\.html?$/i.test(f.path)}
            fileLabel="Add components to"
          />
        </div>
        {insertNote && (
          <p
            className="mx-3 mb-3 px-3 py-2 rounded-lg text-xs leading-relaxed flex gap-2"
            style={{
              color: insertFailed ? '#fcd34d' : '#86efac',
              background: insertFailed ? 'rgba(245,158,11,0.1)' : 'rgba(63,185,80,0.1)',
            }}
          >
            {insertFailed && <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />}
            <span>{insertNote}</span>
          </p>
        )}
        {apps.length > 0 && (
          <p className="hidden md:flex mx-3 mb-3 text-[11px] text-gray-500 gap-1.5 leading-snug">
            <History size={11} className="mt-0.5 flex-shrink-0" />
            A restore point is saved before each change, so you can undo it from Versioning.
          </p>
        )}
      </div>

      {activeTab === 'components' && <div className="flex flex-1 flex-col md:flex-row overflow-hidden">
      {/* ── Categories. A fixed 220px rail leaves nothing beside it on a phone, so on small screens
             this becomes a horizontal scroller instead. ── */}
      <div className="flex-shrink-0 flex md:block md:w-[220px] overflow-x-auto md:overflow-x-visible md:overflow-y-auto border-b md:border-b-0 md:border-r border-gray-800 py-2 md:py-3">
        <div className="hidden md:block px-4 py-2 mb-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Categories</p>
        </div>
        {CATEGORIES.map(cat => {
          const Icon = cat.icon;
          const active = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => { setActiveCategory(cat.id); setSearch(''); }}
              className={`flex-shrink-0 md:w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2 md:py-2.5 text-left whitespace-nowrap transition-colors ${
                active
                  ? 'bg-indigo-600/20 text-indigo-400 md:border-r-2 md:border-indigo-500'
                  : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
              }`}
            >
              <Icon size={14} className="flex-shrink-0" />
              <span className="text-xs font-medium md:flex-1">{cat.label}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                active ? 'bg-indigo-600/30 text-indigo-300' : 'bg-gray-800 text-gray-500'
              }`}>
                {cat.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Center Grid ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search */}
        <div className="flex-shrink-0 px-4 py-3 border-b border-gray-800">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search components..."
              className="w-full pl-9 pr-4 py-2 rounded-lg text-xs outline-none"
              style={{ background: '#161b22', border: '1px solid #30363d', color: '#e6edf3' }}
            />
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredComponents.length === 0 ? (
            <div className="text-center text-gray-600 py-16 text-sm">No components found</div>
          ) : (
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              {filteredComponents.map(comp => {
                const isFav = favs.includes(comp.id);
                const isSelected = selected?.id === comp.id;
                return (
                  <div
                    key={comp.id}
                    onClick={() => setSelected(comp)}
                    className="group cursor-pointer rounded-xl overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/40"
                    style={{
                      background: '#161b22',
                      border: isSelected ? '1px solid #6366f1' : '1px solid #30363d',
                    }}
                  >
                    {/* Preview iframe */}
                    <div className="relative h-[180px] overflow-hidden" style={{ background: '#0d1117' }}>
                      <iframe
                        srcDoc={buildSrcdoc(comp.html)}
                        className="w-full h-full pointer-events-none"
                        style={{ border: 'none', transform: 'scale(0.65)', transformOrigin: 'top left', width: '154%', height: '277px' }}
                        title={comp.name}
                        sandbox="allow-scripts"
                      />
                      {/* Overlay on hover for click-to-expand */}
                      <div
                        className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: 'rgba(0,0,0,0.5)' }}
                        onClick={e => { e.stopPropagation(); setModalComp(comp); }}
                      >
                        <div className="flex items-center gap-1.5 bg-gray-900/90 text-white text-xs px-3 py-1.5 rounded-full">
                          <Eye size={11} /> Preview
                        </div>
                      </div>
                      {/* Fav button */}
                      <button
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={e => toggleFav(comp.id, e)}
                      >
                        <Star
                          size={14}
                          className={isFav ? 'text-yellow-400 fill-yellow-400' : 'text-gray-500 hover:text-yellow-400'}
                        />
                      </button>
                    </div>

                    {/* Card Footer */}
                    <div className="p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-semibold text-gray-200 truncate">{comp.name}</p>
                        {isFav && <Star size={11} className="text-yellow-400 fill-yellow-400 flex-shrink-0" />}
                      </div>
                      <div className="flex flex-wrap gap-1 mb-2.5">
                        {comp.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#1f2937', color: '#9ca3af' }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          className="flex-1 flex items-center justify-center gap-1 text-[11px] py-1.5 rounded-md transition-colors"
                          style={{ background: '#1f2937', color: '#9ca3af' }}
                          onClick={e => { e.stopPropagation(); copyToClipboard(comp.html, comp.id + '_copy'); }}
                        >
                          {copied === comp.id + '_copy' ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                          {copied === comp.id + '_copy' ? 'Copied!' : 'Copy'}
                        </button>
                        <button
                          className="flex-1 text-[11px] py-1.5 rounded-md transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: '#3730a3', color: '#c7d2fe' }}
                          disabled={!canInsert || !!inserting}
                          onClick={e => { e.stopPropagation(); void addToApp(comp.html, comp.name, comp.id); }}
                        >
                          {inserting === comp.id ? 'Adding…' : 'Add to app'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div className="flex-shrink-0 w-full md:w-[300px] border-t md:border-t-0 md:border-l border-gray-800 flex flex-col overflow-hidden">
        {selected ? (
          <>
            {/* Large Preview */}
            <div className="flex-shrink-0 relative" style={{ height: '220px', background: '#0d1117', borderBottom: '1px solid #30363d' }}>
              <iframe
                srcDoc={buildSrcdoc(selected.html, customizer)}
                className="w-full h-full"
                style={{ border: 'none', transform: 'scale(0.8)', transformOrigin: 'top left', width: '125%', height: '275px' }}
                title={selected.name + ' preview'}
                sandbox="allow-scripts"
              />
            </div>

            {/* Detail + Customizer */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-white mb-0.5">{selected.name}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{selected.description}</p>
              </div>

              {/* Copy buttons */}
              <div className="space-y-2">
                <button
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-colors"
                  style={{ background: '#1f2937', color: '#e2e8f0', border: '1px solid #374151' }}
                  onClick={() => copyToClipboard(selected.html, 'raw')}
                >
                  {copied === 'raw' ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  {copied === 'raw' ? 'Copied!' : 'Copy HTML'}
                </button>
                <button
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-colors"
                  style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #3730a3' }}
                  onClick={() => copyToClipboard(WRAP(selected.html), 'full')}
                >
                  {copied === 'full' ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  {copied === 'full' ? 'Copied!' : 'Copy with Tailwind CDN'}
                </button>
                <button
                  className="w-full py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: '#4f46e5', color: '#fff' }}
                  disabled={!canInsert || !!inserting}
                  onClick={() => void addToApp(selected.html, selected.name, 'sel_' + selected.id)}
                >
                  {inserting === 'sel_' + selected.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {inserting === 'sel_' + selected.id ? 'Adding to your app…' : 'Add to my app'}
                </button>
              </div>

              {/* Customizer */}
              <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '10px', padding: '14px' }}>
                <p className="text-xs font-semibold text-gray-300 mb-3 flex items-center gap-1.5">
                  <Layout size={12} /> Quick Customizer
                </p>

                {/* Color */}
                <div className="mb-3">
                  <label className="text-[11px] text-gray-500 block mb-1.5">Primary Color</label>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-7 h-7 rounded-md flex-shrink-0 cursor-pointer border border-gray-700 overflow-hidden relative"
                      style={{ background: customizer.primaryColor }}
                    >
                      <input
                        type="color"
                        value={customizer.primaryColor}
                        onChange={e => setCustomizer(prev => ({ ...prev, primaryColor: e.target.value }))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>
                    <input
                      type="text"
                      value={customizer.primaryColor}
                      onChange={e => {
                        const v = e.target.value;
                        if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setCustomizer(prev => ({ ...prev, primaryColor: v }));
                      }}
                      className="flex-1 px-2 py-1 rounded text-xs outline-none"
                      style={{ background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3' }}
                    />
                  </div>
                </div>

                {/* Font Size */}
                <div className="mb-3">
                  <label className="text-[11px] text-gray-500 block mb-1.5 flex items-center gap-1">
                    <Type size={10} /> Font Size
                  </label>
                  <div className="flex gap-1">
                    {(['small', 'medium', 'large'] as const).map(fs => (
                      <button
                        key={fs}
                        onClick={() => setCustomizer(prev => ({ ...prev, fontSize: fs }))}
                        className="flex-1 py-1 text-[11px] rounded capitalize transition-colors"
                        style={{
                          background: customizer.fontSize === fs ? '#4f46e5' : '#1f2937',
                          color: customizer.fontSize === fs ? '#fff' : '#9ca3af',
                        }}
                      >
                        {fs}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Rounded */}
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1.5 flex items-center gap-1">
                    <Square size={10} /> Rounded
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    {(['none', 'small', 'large', 'full'] as const).map(r => (
                      <button
                        key={r}
                        onClick={() => setCustomizer(prev => ({ ...prev, rounded: r }))}
                        className="py-1 text-[10px] rounded capitalize transition-colors"
                        style={{
                          background: customizer.rounded === r ? '#4f46e5' : '#1f2937',
                          color: customizer.rounded === r ? '#fff' : '#9ca3af',
                        }}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center p-8">
            <div>
              <LayoutGrid size={32} className="text-gray-700 mx-auto mb-3" />
              <p className="text-gray-600 text-xs">Select a component<br />to preview and customize</p>
            </div>
          </div>
        )}
      </div>
      </div>}

      {/* ── Modal Preview ── */}
      {modalComp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.8)' }}
          onClick={() => setModalComp(null)}
        >
          <div
            className="relative rounded-2xl overflow-hidden shadow-2xl"
            style={{ width: '700px', maxWidth: '90vw', background: '#161b22', border: '1px solid #30363d' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#30363d' }}>
              <div>
                <p className="text-white font-semibold text-sm">{modalComp.name}</p>
                <div className="flex gap-1.5 mt-1">
                  {modalComp.tags.map(t => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#1f2937', color: '#6b7280' }}>{t}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
                  style={{ background: '#1f2937', color: '#9ca3af' }}
                  onClick={() => copyToClipboard(modalComp.html, 'modal')}
                >
                  {copied === 'modal' ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                  {copied === 'modal' ? 'Copied!' : 'Copy HTML'}
                </button>
                <button onClick={() => setModalComp(null)} className="text-gray-500 hover:text-white transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>
            <div style={{ height: '420px', background: '#0d1117' }}>
              <iframe
                srcDoc={buildSrcdoc(modalComp.html)}
                className="w-full h-full"
                style={{ border: 'none' }}
                title={modalComp.name + ' full preview'}
                sandbox="allow-scripts"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Copied Toast ── */}
      {copied && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full shadow-xl text-sm font-medium"
          style={{ background: '#22c55e', color: '#fff' }}>
          <Check size={14} /> Copied to clipboard!
        </div>
      )}
    </div>
  );
};

export default ComponentLibrary;
