import { useState, useEffect } from 'react';
import { Package, Search, Star, Copy, Check, Code, Shield, Plus, X } from 'lucide-react';

interface APIItem {
  id: string;
  name: string;
  category: string;
  categoryEmoji: string;
  description: string;
  free: boolean;
  popular: boolean;
  difficulty: 'Easy' | 'Medium' | 'Advanced';
  snippet: string;
  envKey?: string;
  steps: string[];
}

const APIS: APIItem[] = [
  // Maps
  { id: 'gmaps', name: 'Google Maps Embed', category: 'Maps', categoryEmoji: '🗺️', description: 'Embed Google Maps in your app without API key using iframe', free: true, popular: true, difficulty: 'Easy', snippet: `<!-- Google Maps Embed — No API key needed -->
<iframe
  src="https://maps.google.com/maps?q=New+Delhi,India&output=embed"
  width="100%" height="400" style="border:0;" allowfullscreen loading="lazy">
</iframe>`, steps: ['Change the location name in the iframe src', 'Adjust the width/height', 'Ready!'] },
  { id: 'openstreet', name: 'OpenStreetMap (Leaflet)', category: 'Maps', categoryEmoji: '🗺️', description: 'Free open-source map library — no API key required', free: true, popular: true, difficulty: 'Easy', snippet: `<!-- Leaflet.js — Free Map -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<div id="map" style="height:400px;"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const map = L.map('map').setView([28.6, 77.2], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  L.marker([28.6, 77.2]).addTo(map).bindPopup('Meri location').openPopup();
</script>`, steps: ['Paste into your HTML', 'Change the setView coordinates', 'Add a marker'] },
  { id: 'ipgeo', name: 'IP Geolocation', category: 'Maps', categoryEmoji: '🗺️', description: 'Get user location from their IP address — completely free', free: true, popular: false, difficulty: 'Easy', envKey: '', snippet: `// IP Geolocation — Free, no API key
const res = await fetch('https://ipapi.co/json/');
const data = await res.json();
console.log(data.city, data.country_name, data.latitude, data.longitude);
// Output: Mumbai, India, 19.07, 72.87`, steps: ['Just fetch', 'You get city, country data', 'User location auto-detect!'] },
  { id: 'mapbox', name: 'Mapbox', category: 'Maps', categoryEmoji: '🗺️', description: 'Professional maps with custom styling and geocoding', free: false, popular: true, difficulty: 'Medium', envKey: 'MAPBOX_TOKEN', snippet: `// Mapbox GL JS
import mapboxgl from 'mapbox-gl';
mapboxgl.accessToken = process.env.MAPBOX_TOKEN;
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/dark-v11',
  center: [77.2, 28.6],
  zoom: 12
});`, steps: ['Create an account at mapbox.com', 'Copy the token into .env', 'npm install mapbox-gl'] },

  // Weather
  { id: 'openmeteo', name: 'Open-Meteo', category: 'Weather', categoryEmoji: '🌤️', description: '100% free weather API — no registration, no API key needed', free: true, popular: true, difficulty: 'Easy', snippet: `// Open-Meteo — Free, no API key!
const res = await fetch(
  'https://api.open-meteo.com/v1/forecast?latitude=28.6&longitude=77.2&current_weather=true&hourly=temperature_2m'
);
const data = await res.json();
const { temperature, windspeed, weathercode } = data.current_weather;
console.log(\`Temp: \${temperature}°C, Wind: \${windspeed} km/h\`);`, steps: ['Just fetch — no key needed!', 'Change latitude/longitude', 'Data comes back in current_weather'] },
  { id: 'openweather', name: 'OpenWeatherMap', category: 'Weather', categoryEmoji: '🌤️', description: 'Detailed weather data with icons, forecasts and alerts', free: false, popular: true, difficulty: 'Easy', envKey: 'OPENWEATHER_API_KEY', snippet: `// OpenWeatherMap
const API_KEY = process.env.OPENWEATHER_API_KEY;
const res = await fetch(
  \`https://api.openweathermap.org/data/2.5/weather?q=Mumbai,IN&appid=\${API_KEY}&units=metric\`
);
const data = await res.json();
console.log(data.main.temp, data.weather[0].description);`, steps: ['Create a free account at openweathermap.org', 'Save the API key in .env', 'Change the city name in q='] },
  { id: 'weatherapi', name: 'WeatherAPI', category: 'Weather', categoryEmoji: '🌤️', description: 'Real-time and forecast weather with air quality data', free: false, popular: false, difficulty: 'Easy', envKey: 'WEATHERAPI_KEY', snippet: `// WeatherAPI.com
const res = await fetch(
  \`https://api.weatherapi.com/v1/current.json?key=\${process.env.WEATHERAPI_KEY}&q=Delhi&aqi=yes\`
);
const { location, current } = await res.json();
console.log(location.name, current.temp_c, current.air_quality.pm2_5);`, steps: ['Sign up at weatherapi.com', 'Free plan includes 1M calls/month', 'Use q= with city or lat,lon'] },
  { id: 'tomorrow', name: 'Tomorrow.io', category: 'Weather', categoryEmoji: '🌤️', description: 'Hyper-accurate weather with climate insights', free: false, popular: false, difficulty: 'Medium', envKey: 'TOMORROW_API_KEY', snippet: `// Tomorrow.io
const res = await fetch(
  \`https://api.tomorrow.io/v4/weather/realtime?location=mumbai&apikey=\${process.env.TOMORROW_API_KEY}\`
);
const { data } = await res.json();
console.log(data.values.temperature, data.values.humidity);`, steps: ['Create an account at tomorrow.io', 'Free plan includes 25 calls/hour', 'Use location with city/coordinates'] },

  // Payments
  { id: 'razorpay', name: 'Razorpay', category: 'Payments', categoryEmoji: '💳', description: 'India ka #1 payment gateway — UPI, cards, netbanking', free: false, popular: true, difficulty: 'Medium', envKey: 'RAZORPAY_KEY_ID', snippet: `// Razorpay Payment
const options = {
  key: process.env.RAZORPAY_KEY_ID,
  amount: 49900, // Amount in paise (₹499)
  currency: 'INR',
  name: 'Mera App',
  description: 'Purchase',
  handler: function(response) {
    console.log('Payment success:', response.razorpay_payment_id);
    verifyPayment(response); // Server-side verification is required
  },
  prefill: { name: 'User Name', email: 'user@email.com' },
  theme: { color: '#6366f1' }
};
const rzp = new window.Razorpay(options);
rzp.open();`, steps: ['Sign up at razorpay.com', 'Copy the test keys from the dashboard', 'Add the script tag: src="https://checkout.razorpay.com/v1/checkout.js"'] },
  { id: 'cashfree', name: 'Cashfree', category: 'Payments', categoryEmoji: '💳', description: 'Low-cost payment gateway with instant settlements', free: false, popular: true, difficulty: 'Medium', envKey: 'CASHFREE_APP_ID', snippet: `// Cashfree Payment
const cashfree = await load({ mode: 'sandbox' }); // 'production' for live
const checkoutOptions = {
  paymentSessionId: 'SESSION_ID_FROM_SERVER', // Generate on the server
  redirectTarget: '_modal',
};
const result = await cashfree.checkout(checkoutOptions);
if (result.error) console.error(result.error.message);
if (result.paymentDetails) console.log('Paid!', result.paymentDetails);`, steps: ['Sign up at cashfree.com', 'npm install @cashfreepayments/cashfree-js', 'Create a session on the backend first'] },
  { id: 'stripe', name: 'Stripe', category: 'Payments', categoryEmoji: '💳', description: 'Global payments — ideal for international customers', free: false, popular: true, difficulty: 'Advanced', envKey: 'STRIPE_PUBLISHABLE_KEY', snippet: `// Stripe Elements
import { loadStripe } from '@stripe/stripe-js';
const stripe = await loadStripe(process.env.STRIPE_PUBLISHABLE_KEY);
const elements = stripe.elements();
const card = elements.create('card');
card.mount('#card-element');

// On form submit:
const { error, paymentMethod } = await stripe.createPaymentMethod({
  type: 'card',
  card: card,
});
// Send paymentMethod.id to server`, steps: ['Create an account at stripe.com', 'npm install @stripe/stripe-js @stripe/react-stripe-js', 'Create a PaymentIntent on the backend'] },
  { id: 'payu', name: 'PayU', category: 'Payments', categoryEmoji: '💳', description: 'Popular Indian payment gateway with EMI support', free: false, popular: false, difficulty: 'Medium', envKey: 'PAYU_MERCHANT_KEY', snippet: `// PayU Payment Form
const payuData = {
  key: process.env.PAYU_MERCHANT_KEY,
  txnid: 'TXN' + Date.now(),
  amount: '499.00',
  productinfo: 'Subscription',
  firstname: 'User',
  email: 'user@email.com',
  phone: '9876543210',
  surl: 'https://yourapp.com/success',
  furl: 'https://yourapp.com/failure',
  hash: '' // SHA-512 hash — calculate on the server
};
// POST to https://secure.payu.in/_payment`, steps: ['Create a merchant account at payu.in', 'The hash must be calculated server-side', 'Try in test mode first'] },

  // Communication
  { id: 'emailjs', name: 'EmailJS', category: 'Communication', categoryEmoji: '📨', description: 'Send emails directly from frontend — no backend needed!', free: true, popular: true, difficulty: 'Easy', envKey: 'EMAILJS_PUBLIC_KEY', snippet: `// EmailJS — send email from the frontend
import emailjs from '@emailjs/browser';

emailjs.init(process.env.EMAILJS_PUBLIC_KEY);

await emailjs.send('SERVICE_ID', 'TEMPLATE_ID', {
  to_name: 'Recipient',
  from_name: 'Sender',
  message: 'Hello from NavBharatAI!',
  reply_to: 'sender@email.com'
});
console.log('Email sent successfully!');`, steps: ['emailjs.com pe signup', 'npm install @emailjs/browser', 'Get the Service & Template ID from the dashboard'] },
  { id: 'sendgrid', name: 'SendGrid Email', category: 'Communication', categoryEmoji: '📨', description: 'Transactional emails — OTP, welcome, notifications', free: false, popular: true, difficulty: 'Medium', envKey: 'SENDGRID_API_KEY', snippet: `// SendGrid (Node.js backend)
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
await sgMail.send({
  to: 'user@example.com',
  from: 'noreply@yourapp.com', // Verified sender
  subject: 'Welcome to NavBharatAI!',
  html: '<h1>Welcome!</h1><p>The app is ready.</p>',
});`, steps: ['Create a free account at sendgrid.com', 'npm install @sendgrid/mail', 'Verify the sender email'] },
  { id: 'twilio', name: 'Twilio SMS', category: 'Communication', categoryEmoji: '📨', description: 'Send OTP and SMS messages to any phone number', free: false, popular: true, difficulty: 'Medium', envKey: 'TWILIO_ACCOUNT_SID', snippet: `// Twilio SMS (Node.js)
const client = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
await client.messages.create({
  body: 'Your OTP: 123456',
  from: '+1234567890', // Twilio number
  to: '+919876543210'
});`, steps: ['Create a trial account at twilio.com', 'npm install twilio', 'Copy the Account SID + Auth Token'] },
  { id: 'msg91', name: 'MSG91 SMS', category: 'Communication', categoryEmoji: '📨', description: 'Indian SMS gateway — OTP, transactional, promotional', free: false, popular: true, difficulty: 'Easy', envKey: 'MSG91_AUTH_KEY', snippet: `// MSG91 OTP Send
const res = await fetch('https://api.msg91.com/api/v5/otp', {
  method: 'POST',
  headers: {
    'authkey': process.env.MSG91_AUTH_KEY,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    mobile: '919876543210',
    template_id: 'YOUR_TEMPLATE_ID',
    otp: Math.floor(100000 + Math.random() * 900000)
  })
});`, steps: ['Create an account at msg91.com', 'Create a template with DLT', 'Get the authkey from the API section'] },

  // Auth
  { id: 'firebase-auth', name: 'Firebase Auth', category: 'Authentication', categoryEmoji: '🔐', description: 'Email, Google, Phone OTP — easy auth in minutes', free: true, popular: true, difficulty: 'Easy', envKey: 'FIREBASE_API_KEY', snippet: `// Firebase Auth
import { getAuth, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
const auth = getAuth();

// Email login
const user = await signInWithEmailAndPassword(auth, email, password);

// Google login
const provider = new GoogleAuthProvider();
const result = await signInWithPopup(auth, provider);
console.log(result.user.displayName);`, steps: ['Create a project at firebase.google.com', 'npm install firebase', 'Enable Authentication in the console'] },
  { id: 'supabase-auth', name: 'Supabase Auth', category: 'Authentication', categoryEmoji: '🔐', description: 'Open-source Firebase alternative with magic links', free: true, popular: true, difficulty: 'Easy', envKey: 'SUPABASE_URL', snippet: `// Supabase Auth
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Sign up
const { data, error } = await supabase.auth.signUp({ email, password });

// Magic Link
await supabase.auth.signInWithOtp({ email: 'user@example.com' });

// Get user
const { data: { user } } = await supabase.auth.getUser();`, steps: ['Create a project at supabase.com', 'npm install @supabase/supabase-js', 'URL + anon key dashboard se'] },
  { id: 'auth0', name: 'Auth0', category: 'Authentication', categoryEmoji: '🔐', description: 'Enterprise-grade auth with social logins and SSO', free: false, popular: true, difficulty: 'Medium', envKey: 'AUTH0_DOMAIN', snippet: `// Auth0 React SDK
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';

// Wrap your app:
<Auth0Provider domain={process.env.AUTH0_DOMAIN} clientId={AUTH0_CLIENT_ID} authorizationParams={{ redirect_uri: window.location.origin }}>
  <App />
</Auth0Provider>

// Component mein:
const { loginWithRedirect, user, logout } = useAuth0();
<button onClick={loginWithRedirect}>Login</button>`, steps: ['Create a free account at auth0.com', 'npm install @auth0/auth0-react', 'Copy the Domain + Client ID'] },
  { id: 'google-oauth', name: 'Google OAuth', category: 'Authentication', categoryEmoji: '🔐', description: 'Sign in with Google — the most trusted auth flow', free: true, popular: true, difficulty: 'Easy', snippet: `// Google One Tap / OAuth
<script src="https://accounts.google.com/gsi/client" async defer></script>
<div id="g_id_onload"
  data-client_id="YOUR_GOOGLE_CLIENT_ID"
  data-context="signin"
  data-callback="handleCredentialResponse">
</div>
<div class="g_id_signin" data-type="standard"></div>
<script>
function handleCredentialResponse(response) {
  console.log('Token:', response.credential);
  // Send to backend for verification
}
</script>`, envKey: 'GOOGLE_CLIENT_ID', steps: ['Create OAuth2 credentials in Google Cloud Console', 'Copy the Client ID', 'Add authorized origins'] },

  // AI
  { id: 'gemini', name: 'Google Gemini', category: 'AI & ML', categoryEmoji: '🤖', description: 'Google ka most powerful AI — text, vision, code generation', free: true, popular: true, difficulty: 'Easy', envKey: 'GEMINI_API_KEY', snippet: `// Google Gemini API
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

const result = await model.generateContent('Generate React app code for login');
console.log(result.response.text());`, steps: ['Get a free API key at aistudio.google.com', 'npm install @google/generative-ai', 'gemini-2.0-flash is fast and free'] },
  { id: 'openai', name: 'OpenAI GPT', category: 'AI & ML', categoryEmoji: '🤖', description: 'GPT-4 for text generation, code, analysis', free: false, popular: true, difficulty: 'Easy', envKey: 'OPENAI_API_KEY', snippet: `// OpenAI GPT
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const response = await client.chat.completions.create({
  model: 'gpt-4o-mini', // Affordable model
  messages: [{ role: 'user', content: 'Build a React component for a counter' }],
});
console.log(response.choices[0].message.content);`, steps: ['platform.openai.com pe account', 'npm install openai', 'Keep the API key safely on the backend'] },
  { id: 'huggingface', name: 'HuggingFace', category: 'AI & ML', categoryEmoji: '🤖', description: 'Thousands of free AI models — text, image, audio', free: true, popular: true, difficulty: 'Easy', envKey: 'HF_TOKEN', snippet: `// HuggingFace Inference API
const response = await fetch(
  'https://api-inference.huggingface.co/models/facebook/bart-large-cnn',
  {
    method: 'POST',
    headers: { Authorization: \`Bearer \${process.env.HF_TOKEN}\` },
    body: JSON.stringify({ inputs: 'Long text to summarize here...' })
  }
);
const result = await response.json();
console.log(result[0].summary_text);`, steps: ['Create a free account at huggingface.co', 'Create a token from Settings > Tokens', 'Choose a model based on your task'] },
  { id: 'anthropic', name: 'Anthropic Claude', category: 'AI & ML', categoryEmoji: '🤖', description: 'Claude — safe and helpful AI for complex reasoning', free: false, popular: true, difficulty: 'Easy', envKey: 'ANTHROPIC_API_KEY', snippet: `// Anthropic Claude
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const message = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Explain this code: ...' }],
});
console.log(message.content[0].text);`, steps: ['console.anthropic.com pe account', 'npm install @anthropic-ai/sdk', 'Keep the API key safely on the server'] },

  // Database
  { id: 'firestore', name: 'Firebase Firestore', category: 'Database', categoryEmoji: '🗄️', description: 'Real-time NoSQL database — perfect for live apps', free: true, popular: true, difficulty: 'Easy', envKey: 'FIREBASE_API_KEY', snippet: `// Firebase Firestore
import { getFirestore, doc, setDoc, getDoc, collection, getDocs } from 'firebase/firestore';
const db = getFirestore(app);

// Save data
await setDoc(doc(db, 'users', userId), { name: 'Arjun', city: 'Mumbai' });

// Read data
const docSnap = await getDoc(doc(db, 'users', userId));
if (docSnap.exists()) console.log(docSnap.data());

// Get collection
const querySnapshot = await getDocs(collection(db, 'users'));
querySnapshot.forEach(doc => console.log(doc.data()));`, steps: ['Create a project at firebase.google.com', 'npm install firebase', 'Configure the security rules'] },
  { id: 'supabase-db', name: 'Supabase DB', category: 'Database', categoryEmoji: '🗄️', description: 'PostgreSQL database with REST API and realtime', free: true, popular: true, difficulty: 'Easy', envKey: 'SUPABASE_URL', snippet: `// Supabase Database
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Insert
const { data, error } = await supabase.from('posts').insert([{ title: 'Hello', body: 'World' }]);

// Select
const { data: posts } = await supabase.from('posts').select('*').order('created_at', { ascending: false });

// Update
await supabase.from('posts').update({ title: 'Updated' }).eq('id', postId);`, steps: ['Create a project at supabase.com', 'npm install @supabase/supabase-js', 'Create a table in the dashboard'] },
  { id: 'mongodb', name: 'MongoDB Atlas', category: 'Database', categoryEmoji: '🗄️', description: 'Document database — flexible schema, free tier', free: true, popular: true, difficulty: 'Medium', envKey: 'MONGODB_URI', snippet: `// MongoDB (Node.js)
const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();

const db = client.db('myapp');
const users = db.collection('users');

// Insert
await users.insertOne({ name: 'Ravi', email: 'ravi@example.com' });

// Find
const allUsers = await users.find({}).toArray();
console.log(allUsers);`, steps: ['Create a free M0 cluster at mongodb.com', 'npm install mongodb', 'Store the connection string in .env'] },
  { id: 'planetscale', name: 'PlanetScale (MySQL)', category: 'Database', categoryEmoji: '🗄️', description: 'Serverless MySQL with branching like Git', free: true, popular: false, difficulty: 'Medium', envKey: 'DATABASE_URL', snippet: `// PlanetScale with Prisma
// schema.prisma:
// datasource db { provider = "mysql"; url = env("DATABASE_URL") }
// model User { id Int @id @default(autoincrement()); name String; email String @unique }

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const user = await prisma.user.create({ data: { name: 'Meera', email: 'meera@test.com' } });
const users = await prisma.user.findMany();`, steps: ['planetscale.com pe database', 'npm install prisma @prisma/client', 'npx prisma init && migrate'] },

  // Media
  { id: 'cloudinary', name: 'Cloudinary', category: 'Media', categoryEmoji: '🎨', description: 'Image/video upload, transform, CDN delivery', free: true, popular: true, difficulty: 'Easy', envKey: 'CLOUDINARY_CLOUD_NAME', snippet: `// Cloudinary Upload Widget
<script src="https://upload-widget.cloudinary.com/global/all.js"></script>
<button onclick="openWidget()">Upload Image</button>
<script>
function openWidget() {
  cloudinary.openUploadWidget({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    uploadPreset: 'your_preset',
  }, (error, result) => {
    if (!error && result.event === 'success') {
      console.log('URL:', result.info.secure_url);
    }
  });
}
</script>`, steps: ['Create a free account at cloudinary.com', 'Create an upload preset (unsigned)', 'Copy the cloud name'] },
  { id: 'youtube', name: 'YouTube Data API', category: 'Media', categoryEmoji: '🎨', description: 'Search videos, get channel data, embed player', free: false, popular: true, difficulty: 'Easy', envKey: 'YOUTUBE_API_KEY', snippet: `// YouTube Search
const res = await fetch(
  \`https://www.googleapis.com/youtube/v3/search?part=snippet&q=React+tutorial&type=video&maxResults=5&key=\${process.env.YOUTUBE_API_KEY}\`
);
const { items } = await res.json();
items.forEach(item => {
  console.log(item.snippet.title, item.id.videoId);
  // Embed: https://www.youtube.com/embed/VIDEO_ID
});`, steps: ['Enable the YouTube API in Google Cloud Console', 'Copy the API key', 'Free quota: 10,000 units/day'] },
  { id: 'unsplash', name: 'Unsplash Photos', category: 'Media', categoryEmoji: '🎨', description: 'Millions of free high-quality photos via API', free: true, popular: true, difficulty: 'Easy', envKey: 'UNSPLASH_ACCESS_KEY', snippet: `// Unsplash Random Photo
const res = await fetch(
  \`https://api.unsplash.com/photos/random?query=nature&client_id=\${process.env.UNSPLASH_ACCESS_KEY}\`
);
const photo = await res.json();
console.log(photo.urls.regular); // Image URL
console.log(photo.user.name);   // Photographer name

// Search photos:
// https://api.unsplash.com/search/photos?query=city&client_id=KEY`, steps: ['Create an app at unsplash.com/developers', 'Copy the Access Key', 'Free: 50 requests/hour'] },
  { id: 'imgur', name: 'Imgur Upload', category: 'Media', categoryEmoji: '🎨', description: 'Anonymous image hosting — no auth required', free: true, popular: false, difficulty: 'Easy', envKey: 'IMGUR_CLIENT_ID', snippet: `// Imgur Anonymous Upload
const formData = new FormData();
formData.append('image', file); // File input se

const res = await fetch('https://api.imgur.com/3/image', {
  method: 'POST',
  headers: { Authorization: \`Client-ID \${process.env.IMGUR_CLIENT_ID}\` },
  body: formData,
});
const { data } = await res.json();
console.log('Hosted URL:', data.link);`, steps: ['Register an app at imgur.com/oauth2/addclient', 'Copy the Client ID', 'The file uploads directly'] },
];

const CATEGORIES = ['All', 'Maps', 'Weather', 'Payments', 'Communication', 'Authentication', 'AI & ML', 'Database', 'Media'];

export function APIMarketplace({ onCodeInsert }: { onCodeInsert: (code: string) => void }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedApi, setSelectedApi] = useState<APIItem | null>(null);
  const [copiedId, setCopiedId] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);

  useEffect(() => {
    try {
      const fav = localStorage.getItem('navbharat_api_favorites');
      if (fav) setFavorites(JSON.parse(fav));
    } catch {}
  }, []);

  const toggleFavorite = (id: string) => {
    const updated = favorites.includes(id) ? favorites.filter(f => f !== id) : [...favorites, id];
    setFavorites(updated);
    try { localStorage.setItem('navbharat_api_favorites', JSON.stringify(updated)); } catch {}
  };

  const copySnippet = (api: APIItem) => {
    navigator.clipboard.writeText(api.snippet).then(() => {
      setCopiedId(api.id);
      setTimeout(() => setCopiedId(''), 2000);
    });
  };

  const filtered = APIS.filter(api => {
    if (showFavorites && !favorites.includes(api.id)) return false;
    if (selectedCategory !== 'All' && api.category !== selectedCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return api.name.toLowerCase().includes(q) || api.description.toLowerCase().includes(q) || api.category.toLowerCase().includes(q);
    }
    return true;
  });

  const difficultyColor = (d: string) => d === 'Easy' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : d === 'Medium' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-red-400 bg-red-500/10 border-red-500/20';

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#161b22]">
        <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center">
          <Package className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h2 className="font-semibold text-white text-base">API Marketplace</h2>
          <p className="text-xs text-white/40">One-click integrations — Maps, Weather, Payments, AI and more</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-white/40">{APIS.length} APIs</span>
          <button
            onClick={() => setShowFavorites(!showFavorites)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${showFavorites ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-white/10 bg-white/5 text-white/40'}`}
          >
            <Star className="w-3 h-3" /> Favorites ({favorites.length})
          </button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="px-4 py-3 border-b border-white/5 bg-[#161b22] space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input
            className="w-full bg-[#0d1117] border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50"
            placeholder="Search APIs... (e.g. payment, weather, auth)"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`shrink-0 text-xs px-3 py-1 rounded-full border transition-all whitespace-nowrap ${
                selectedCategory === cat ? 'border-blue-500/50 bg-blue-500/15 text-blue-300' : 'border-white/10 bg-white/5 text-white/40 hover:border-white/20'
              }`}
            >
              {APIS.find(a => a.category === cat)?.categoryEmoji || '🔧'} {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* API Grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <Package className="w-10 h-10 text-white/10" />
              <p className="text-sm text-white/30">{showFavorites ? 'No favorites yet' : 'No APIs found'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {filtered.map(api => (
                <button
                  key={api.id}
                  onClick={() => setSelectedApi(api)}
                  className={`text-left p-3.5 rounded-xl border transition-all ${
                    selectedApi?.id === api.id ? 'border-blue-500/50 bg-blue-500/5' : 'border-white/5 bg-[#161b22] hover:border-white/10'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1 mb-1.5">
                    <div>
                      <span className="text-sm font-medium text-white">{api.categoryEmoji} {api.name}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {api.popular && <Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
                      <button
                        onClick={e => { e.stopPropagation(); toggleFavorite(api.id); }}
                        className={favorites.includes(api.id) ? 'text-amber-400' : 'text-white/20 hover:text-amber-400'}
                      >
                        <Star className={`w-3 h-3 ${favorites.includes(api.id) ? 'fill-amber-400' : ''}`} />
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-white/40 mb-2 line-clamp-2">{api.description}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-md border font-medium ${api.free ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-amber-400 bg-amber-500/10 border-amber-500/20'}`}>
                      {api.free ? 'Free' : 'Paid'}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-md border ${difficultyColor(api.difficulty)}`}>
                      {api.difficulty}
                    </span>
                    <span className="text-[9px] text-white/20 bg-white/5 px-1.5 py-0.5 rounded-md">{api.category}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div className="w-[38%] border-l border-white/5 flex flex-col overflow-hidden">
          {!selectedApi ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
              <Code className="w-12 h-12 text-white/5" />
              <p className="text-sm text-white/20">Click an API card</p>
              <p className="text-xs text-white/10">Code snippet and setup guide will appear here</p>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-white/5">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <h3 className="font-semibold text-white flex items-center gap-1.5">
                      <span>{selectedApi.categoryEmoji}</span> {selectedApi.name}
                    </h3>
                    <p className="text-xs text-white/40 mt-0.5">{selectedApi.description}</p>
                  </div>
                  <button onClick={() => setSelectedApi(null)} className="text-white/20 hover:text-white/50">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <span className={`text-[9px] px-2 py-0.5 rounded-full border font-medium ${selectedApi.free ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-amber-400 bg-amber-500/10 border-amber-500/20'}`}>
                    {selectedApi.free ? '✓ Free' : '$ Paid'}
                  </span>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full border ${difficultyColor(selectedApi.difficulty)}`}>{selectedApi.difficulty}</span>
                  {selectedApi.popular && <span className="text-[9px] px-2 py-0.5 rounded-full border border-amber-500/20 text-amber-300 bg-amber-500/10">⭐ Popular</span>}
                </div>
              </div>

              {/* Code Snippet */}
              <div className="flex-1 overflow-y-auto">
                <div className="p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-white/40 uppercase tracking-wider">Code Snippet</span>
                    <button onClick={() => copySnippet(selectedApi)} className={`text-[10px] flex items-center gap-1 px-2 py-0.5 rounded-lg transition-colors ${copiedId === selectedApi.id ? 'text-emerald-400 bg-emerald-500/10' : 'text-white/40 hover:text-white/70 bg-white/5'}`}>
                      {copiedId === selectedApi.id ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
                    </button>
                  </div>
                  <pre className="bg-[#0d1117] border border-white/5 rounded-xl p-3 text-[9px] font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap break-all">{selectedApi.snippet}</pre>
                </div>

                {selectedApi.envKey && (
                  <div className="px-3 pb-3">
                    <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1.5">Environment Variable</p>
                    <div className="flex items-center gap-2 bg-[#0d1117] border border-white/5 rounded-lg px-3 py-2">
                      <Shield className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <code className="text-xs text-amber-300 font-mono flex-1">{selectedApi.envKey}=your_key_here</code>
                      <button onClick={() => { navigator.clipboard.writeText(`${selectedApi.envKey}=`); }}>
                        <Copy className="w-3 h-3 text-white/30 hover:text-white/60" />
                      </button>
                    </div>
                    <p className="text-[9px] text-white/20 mt-1">⚠️ Keep the key in server-side .env — never write it in the frontend</p>
                  </div>
                )}

                {/* Setup Steps */}
                <div className="px-3 pb-3">
                  <p className="text-[10px] text-white/40 uppercase tracking-wider mb-2">Quick Setup</p>
                  <div className="space-y-1.5">
                    {selectedApi.steps.map((step, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="w-4 h-4 rounded-full bg-blue-500/20 text-blue-400 text-[9px] flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                        <p className="text-[10px] text-white/50">{step}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="p-3 border-t border-white/5 flex gap-2">
                <button
                  onClick={() => onCodeInsert(selectedApi.snippet)}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Insert in Code
                </button>
                <button
                  onClick={() => toggleFavorite(selectedApi.id)}
                  className={`px-3 py-2 rounded-xl border text-xs transition-all ${favorites.includes(selectedApi.id) ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-white/10 bg-white/5 text-white/40'}`}
                >
                  <Star className={`w-3.5 h-3.5 ${favorites.includes(selectedApi.id) ? 'fill-amber-400' : ''}`} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
