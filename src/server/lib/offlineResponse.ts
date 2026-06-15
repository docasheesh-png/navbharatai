/**
 * Offline / no-API-key fallback response generator (canned answers + simple
 * templated mini-apps). Extracted verbatim from the server.ts monolith
 * (Phase 1, AI-core step b2). Self-contained — no server closures.
 */
export function generateOfflineResponse(message: string, history: any[] = [], systemInstruction?: string): string {
    const msgLower = message.toLowerCase();
    
    // Clean titles & metadata
    const warningText = `### 📡 navBharatAI — Sovereign Heuristic Engine Active

We detected that your Cloud AI access keys are currently unconfigured, have placeholder values, or are restricted by GCP service policies (such as Firebase Web keys blocking generative content).

To ensure you can continue building **completely uninterrupted**, our local **Sovereign Heuristic Coder & Consultant** is now running. I can generate gorgeous, production-grade responsive templates and design layouts corresponding to your requests in real time!

**To unlock full cloud features:** Open the **Settings Panel** (Gear icon on bottom-left) and paste your active **Gemini, Claude, or OpenAI API key**.

---

`;

    // 1. Identify intent & template matching
    let resolvedProjectName = 'Smart Tool';
    let htmlCode = '';
    
    // Keyword mapping for specific widgets
    if (msgLower.includes('calc') || msgLower.includes('calculator') || msgLower.includes('hisaab') || msgLower.includes('ganit')) {
      resolvedProjectName = 'Glassmorphic Neon Calculator';
      htmlCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Glassmorphic Calculator</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Inter', sans-serif;
      background: radial-gradient(circle at top right, #1e1b4b, #09090b);
    }
    .glass {
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
  </style>
</head>
<body class="min-h-screen text-slate-100 flex items-center justify-center p-4">
  <div class="w-full max-w-[360px] p-6 rounded-3xl glass shadow-2xl relative overflow-hidden">
    <!-- Neon Accent Glows -->
    <div class="absolute -top-12 -left-12 w-24 h-24 bg-violet-600/20 blur-2xl rounded-full"></div>
    <div class="absolute -bottom-12 -right-12 w-24 h-24 bg-indigo-600/20 blur-2xl rounded-full"></div>

    <div class="flex items-center justify-between mb-6 shrink-0 relative z-10">
      <div class="flex items-center space-x-2">
        <div class="w-2.5 h-2.5 rounded-full bg-violet-500 animate-pulse"></div>
        <span class="text-[10px] tracking-widest font-bold uppercase text-violet-400">GANIT v1.0</span>
      </div>
      <span class="text-[10px] font-mono text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">DEG</span>
    </div>

    <!-- Display -->
    <div class="mb-6 relative z-10 text-right">
      <div id="equation" class="text-xs font-mono text-slate-400 h-5 overflow-x-auto truncate mb-1"></div>
      <div id="output" class="text-4xl font-light font-mono tracking-tight text-white truncate h-12">0</div>
    </div>

    <!-- Keypad -->
    <div class="grid grid-cols-4 gap-3 relative z-10">
      <button onclick="clearAll()" class="col-span-2 py-4 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-medium text-sm transition-all border border-rose-500/20 active:scale-95">AC</button>
      <button onclick="backspace()" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-slate-300 font-medium text-sm transition-all border border-white/5 active:scale-95">DEL</button>
      <button onclick="append('/')" class="py-4 rounded-2xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 font-bold text-sm transition-all border border-indigo-500/20 active:scale-95">&divide;</button>

      <button onclick="append('7')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">7</button>
      <button onclick="append('8')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">8</button>
      <button onclick="append('9')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">9</button>
      <button onclick="append('*')" class="py-4 rounded-2xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 font-bold text-sm transition-all border border-indigo-500/20 active:scale-95">&times;</button>

      <button onclick="append('4')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">4</button>
      <button onclick="append('5')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">5</button>
      <button onclick="append('6')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">6</button>
      <button onclick="append('-')" class="py-4 rounded-2xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 font-bold text-sm transition-all border border-indigo-500/20 active:scale-95">&minus;</button>

      <button onclick="append('1')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">1</button>
      <button onclick="append('2')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">2</button>
      <button onclick="append('3')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">3</button>
      <button onclick="append('+')" class="py-4 rounded-2xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 font-bold text-sm transition-all border border-indigo-500/20 active:scale-95">+</button>

      <button onclick="append('0')" class="col-span-2 py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">0</button>
      <button onclick="append('.')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">.</button>
      <button onclick="calculate()" class="py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-md transition-all shadow-lg active:scale-95">=</button>
    </div>
  </div>

  <script>
    let expr = '';
    const equationDiv = document.getElementById('equation');
    const outputDiv = document.getElementById('output');

    function append(val) {
      if (expr === '0' && !isNaN(val)) {
        expr = val;
      } else {
        expr += val;
      }
      updateDisplay();
    }

    function clearAll() {
      expr = '';
      updateDisplay();
    }

    function backspace() {
      expr = expr.slice(0, -1);
      updateDisplay();
    }

    function calculate() {
      if (!expr) return;
      try {
        let sanitized = expr.replace(/[^-()\\d/*+.]/g, '');
        let result = eval(sanitized);
        equationDiv.textContent = expr + ' =';
        expr = String(result);
        if (expr === 'undefined' || expr === 'NaN') {
          expr = 'Error';
        }
        updateDisplay();
      } catch (err) {
        outputDiv.textContent = 'Error';
        expr = '';
      }
    }

    function updateDisplay() {
      outputDiv.textContent = expr || '0';
      if (!expr) {
        equationDiv.textContent = '';
      }
    }
  </script>
</body>
</html>`;
    } else if (msgLower.includes('todo') || msgLower.includes('task') || msgLower.includes('list') || msgLower.includes('kam') || msgLower.includes('kaam')) {
      resolvedProjectName = 'TaskMaster Personal Board';
      htmlCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TaskMaster Personal Board</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background-color: #0b0f19; }
    .neon-border { box-shadow: 0 0 15px rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.2); }
  </style>
</head>
<body class="min-h-screen text-slate-100 p-4 md:p-8 flex justify-center items-start">
  <div class="w-full max-w-xl bg-[#111827]/80 backdrop-blur-xl rounded-3xl p-6 md:p-8 neon-border shadow-2xl">
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-2xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">TaskMaster Board</h1>
        <p class="text-xs text-slate-400 mt-1">Organize your daily workflows, goals, and checklists</p>
      </div>
      <div class="bg-indigo-500/10 px-3 py-1.5 rounded-2xl border border-indigo-500/20 text-center">
        <div id="streak-cnt" class="text-sm font-bold text-indigo-400">🔥 0</div>
        <div class="text-[8px] uppercase text-slate-400 font-medium">Daily Streak</div>
      </div>
    </div>

    <!-- Stats Row -->
    <div class="grid grid-cols-3 gap-3 mb-6">
      <div class="bg-slate-800/40 p-3 rounded-2xl border border-white/5 text-center">
        <span class="block text-xs text-slate-400">Total</span>
        <span id="stat-total" class="font-bold text-lg text-white">0</span>
      </div>
      <div class="bg-indigo-500/5 p-3 rounded-2xl border border-indigo-500/10 text-center">
        <span class="block text-xs text-slate-400">Active</span>
        <span id="stat-active" class="font-bold text-lg text-indigo-400">0</span>
      </div>
      <div class="bg-emerald-500/5 p-3 rounded-2xl border border-emerald-500/10 text-center">
        <span class="block text-xs text-slate-400">Completed</span>
        <span id="stat-done" class="font-bold text-lg text-emerald-400">0</span>
      </div>
    </div>

    <!-- Input Area -->
    <form id="todo-form" onsubmit="addTodo(event)" class="flex gap-2 mb-6">
      <input id="todo-input" type="text" placeholder="I want to build a feature today..." required
        class="flex-1 bg-slate-900 border border-slate-700/60 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-all text-white placeholder-slate-500">
      <button type="submit" class="bg-indigo-600 hover:bg-indigo-500 transition-colors text-white px-5 rounded-2xl font-medium text-sm flex items-center gap-1 active:scale-95">Add</button>
    </form>

    <!-- Filters -->
    <div class="flex gap-2 mb-6">
      <button onclick="setFilter('all')" id="filter-all" class="px-3 py-1 rounded-full text-xs font-medium transition-all bg-indigo-600 text-white">All</button>
      <button onclick="setFilter('active')" id="filter-active" class="px-3 py-1 rounded-full text-xs font-medium transition-all text-slate-400 hover:text-white">Active</button>
      <button onclick="setFilter('done')" id="filter-done" class="px-3 py-1 rounded-full text-xs font-medium transition-all text-slate-400 hover:text-white">Done</button>
    </div>

    <!-- Tasks List -->
    <div id="todo-list" class="space-y-3 max-h-[350px] overflow-y-auto pr-1">
      <!-- Dynamic list loaded via localStorage -->
    </div>
  </div>

  <script>
    let todos = JSON.parse(localStorage.getItem('off_todos') || '[]');
    let currentFilter = 'all';

    function save() {
      localStorage.setItem('off_todos', JSON.stringify(todos));
      render();
    }

    function addTodo(e) {
      e.preventDefault();
      const input = document.getElementById('todo-input');
      const text = input.value.trim();
      if (!text) return;
      
      todos.push({
        id: Date.now(),
        text,
        done: false,
        createdAt: new Date().toISOString()
      });
      input.value = '';
      
      let streak = parseInt(localStorage.getItem('off_streak') || '0');
      if (todos.length === 1) {
        streak += 1;
        localStorage.setItem('off_streak', String(streak));
        document.getElementById('streak-cnt').textContent = '🔥 ' + streak;
      }
      
      save();
    }

    function toggleTodo(id) {
      todos = todos.map(t => t.id === id ? { ...t, done: !t.done } : t);
      save();
    }

    function deleteTodo(id) {
      todos = todos.filter(t => t.id !== id);
      save();
    }

    // Set filter
    function setFilter(filter) {
      currentFilter = filter;
      ['all', 'active', 'done'].forEach(f => {
        const btn = document.getElementById('filter-' + f);
        if (f === filter) {
          btn.className = 'px-3 py-1 rounded-full text-xs font-medium transition-all bg-indigo-600 text-white';
        } else {
          btn.className = 'px-3 py-1 rounded-full text-xs font-medium transition-all text-slate-400 hover:text-white';
        }
      });
      render();
    }

    function render() {
      const container = document.getElementById('todo-list');
      container.innerHTML = '';
      
      let filtered = todos;
      if (currentFilter === 'active') filtered = todos.filter(t => !t.done);
      if (currentFilter === 'done') filtered = todos.filter(t => t.done);

      const total = todos.length;
      const doneValue = todos.filter(t => t.done).length;
      document.getElementById('stat-total').textContent = total;
      document.getElementById('stat-active').textContent = total - doneValue;
      document.getElementById('stat-done').textContent = doneValue;

      if (filtered.length === 0) {
        container.innerHTML = \`<div class="text-center py-10 opacity-40 text-xs">No tasks found. Try adding a goal above!</div>\`;
        return;
      }

      filtered.forEach(todo => {
        const div = document.createElement('div');
        div.className = \`flex items-center justify-between p-4 rounded-2xl border transition-all \${todo.done ? 'bg-slate-900/40 border-slate-800 text-slate-400' : 'bg-slate-800/30 border-slate-700/50 hover:border-slate-600'}\`;
        
        div.innerHTML = \`
          <div class="flex items-center gap-3 flex-1">
            <input type="checkbox" \${todo.done ? 'checked' : ''} onchange="toggleTodo(\${todo.id})"
              class="w-4 h-4 rounded-md bg-transparent border border-slate-600 border-2 checked:bg-indigo-600 text-indigo-600 focus:ring-0 cursor-pointer">
            <span class="text-sm \${todo.done ? 'line-through opacity-70' : 'text-slate-200 font-medium'}" style="word-break: break-all;">\${todo.text}</span>
          </div>
          <button onclick="deleteTodo(\${todo.id})" class="text-slate-500 hover:text-rose-400 transition-colors p-1" title="Delete">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        \`;
        container.appendChild(div);
      });
    }

    const streak = parseInt(localStorage.getItem('off_streak') || '0');
    document.getElementById('streak-cnt').textContent = '🔥 ' + streak;
    render();
  </script>
</body>
</html>`;
    } else if (msgLower.includes('weather') || msgLower.includes('mausam') || msgLower.includes('hawa')) {
      resolvedProjectName = 'Horizon Weather Studio';
      htmlCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Horizon Weather Station</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Outfit', sans-serif; background-color: #0c101d; }
    .station-panel { background: radial-gradient(circle at bottom left, #1c233c, #111528); border: 1px solid rgba(255, 255, 255, 0.05); }
    .neon-pulse { box-shadow: 0 0 25px rgba(56, 189, 248, 0.2); }
  </style>
</head>
<body class="min-h-screen text-slate-100 p-4 md:p-8 flex justify-center items-center">
  <div class="w-full max-w-md station-panel rounded-3xl p-6 shadow-2xl overflow-hidden relative">
    
    <!-- Header Controls -->
    <div class="flex items-center gap-2 mb-6">
      <input id="city-input" type="text" placeholder="Search City (e.g. Mumbai, New York, Tokyo)" 
        class="flex-1 bg-slate-900 border border-slate-800 rounded-2xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 transition-all">
      <button onclick="searchCity()" class="bg-sky-500 hover:bg-sky-400 text-slate-900 font-bold px-4 rounded-2xl text-xs py-2.5 transition-all active:scale-95">Go</button>
    </div>

    <!-- Active Weather Display -->
    <div class="text-center py-6 relative">
      <span id="label-city" class="text-xl font-bold tracking-tight">Mumbai</span>
      <span id="label-time" class="block text-[10px] text-slate-400 uppercase tracking-widest mt-1">Local Time: Sunny Outlook</span>
      
      <div class="my-6 flex justify-center">
        <!-- Sun icon with pulse -->
        <div id="icon-weather" class="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center neon-pulse text-amber-400">
          <svg class="w-10 h-10 animate-spin" style="animation-duration: 10s;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-11.314l.707.707m11.314 11.314l.707-.707M12 17a5 5 0 100-10 5 5 0 000 10z" />
          </svg>
        </div>
      </div>

      <div class="flex items-start justify-center">
        <span id="label-temp" class="text-6xl font-light tracking-tighter">32</span>
        <span class="text-sky-400 text-lg font-bold ml-1">&deg;C</span>
      </div>
      <p id="label-desc" class="text-xs text-sky-400 bg-sky-500/10 px-3 py-1 mt-3 rounded-full inline-block font-medium">Warm & Sunny</p>
    </div>

    <!-- Details Card Grid -->
    <div class="grid grid-cols-2 gap-3 mt-6">
      <div class="bg-slate-900/60 p-3 rounded-2xl border border-white/5">
        <span class="block text-[10px] uppercase font-bold text-slate-500">Wind Velocity</span>
        <span id="val-wind" class="text-sm font-semibold text-slate-200 mt-1 block">14 km/h</span>
      </div>
      <div class="bg-slate-900/60 p-3 rounded-2xl border border-white/5">
        <span class="block text-[10px] uppercase font-bold text-slate-500">Relative Humidity</span>
        <span id="val-humidity" class="text-sm font-semibold text-slate-200 mt-1 block">65%</span>
      </div>
      <div class="bg-slate-900/60 p-3 rounded-2xl border border-white/5">
        <span class="block text-[10px] uppercase font-bold text-slate-500">Precipitation Chance</span>
        <span id="val-precip" class="text-sm font-semibold text-slate-200 mt-1 block">5%</span>
      </div>
      <div class="bg-slate-900/60 p-3 rounded-2xl border border-white/5">
        <span class="block text-[10px] uppercase font-bold text-slate-500">UV Index Rating</span>
        <span id="val-uv" class="text-sm font-semibold text-slate-200 mt-1 block">9 (High)</span>
      </div>
    </div>
  </div>

  <script>
    const database = {
      mumbai: { temp: "32", desc: "Warm & Sunny", wind: "14 km/h", humidity: "65%", precip: "5%", uv: "9 (High)", bg: "amber" },
      delhi: { temp: "38", desc: "Hot & Smoggy", wind: "8 km/h", humidity: "30%", precip: "0%", uv: "11 (Extreme)", bg: "orange" },
      london: { temp: "14", desc: "Cool & Drizzle", wind: "22 km/h", humidity: "90%", precip: "80%", uv: "2 (Low)", bg: "sky" },
      tokyo: { temp: "22", desc: "Partly Overcast", wind: "12 km/h", humidity: "50%", precip: "15%", uv: "5 (Moderate)", bg: "teal" },
      newyork: { temp: "18", desc: "Crisp Breeze", wind: "19 km/h", humidity: "45%", precip: "10%", uv: "4 (Moderate)", bg: "indigo" },
    };

    function searchCity() {
      const input = document.getElementById('city-input');
      const val = input.value.trim().toLowerCase().replace(/\\s+/g, '');
      if (!val) return;

      const record = database[val] || {
        temp: String(Math.floor(Math.random() * 15) + 18),
        desc: "Mild Clouds",
        wind: "10 km/h",
        humidity: "55%",
        precip: "20%",
        uv: "6 (High)",
        bg: "teal"
      };

      document.getElementById('label-city').textContent = input.value;
      document.getElementById('label-temp').textContent = record.temp;
      document.getElementById('label-desc').textContent = record.desc;
      document.getElementById('val-wind').textContent = record.wind;
      document.getElementById('val-humidity').textContent = record.humidity;
      document.getElementById('val-precip').textContent = record.precip;
      document.getElementById('val-uv').textContent = record.uv;

      const icon = document.getElementById('icon-weather');
      const desc = record.desc.toLowerCase();

      if (desc.includes('sun') || desc.includes('hot')) {
        icon.className = "w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center neon-pulse text-amber-400";
        icon.innerHTML = \`<svg class="w-10 h-10 animate-spin" style="animation-duration: 10s;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-11.314l.707.707m11.314 11.314l.707-.707M12 17a5 5 0 100-10 5 5 0 000 10z" /></svg>\`;
        document.getElementById('label-desc').className = "text-xs text-amber-400 bg-amber-500/10 px-3 py-1 mt-3 rounded-full inline-block font-medium";
      } else if (desc.includes('cloud') || desc.includes('overcast') || desc.includes('breeze')) {
        icon.className = "w-20 h-20 bg-sky-500/10 rounded-full flex items-center justify-center neon-pulse text-sky-400";
        icon.innerHTML = \`<svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>\`;
        document.getElementById('label-desc').className = "text-xs text-sky-400 bg-sky-500/10 px-3 py-1 mt-3 rounded-full inline-block font-medium";
      } else {
        icon.className = "w-20 h-20 bg-teal-500/10 rounded-full flex items-center justify-center neon-pulse text-teal-400";
        icon.innerHTML = \`<svg class="w-10 h-10 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3" /></svg>\`;
        document.getElementById('label-desc').className = "text-xs text-teal-400 bg-teal-500/10 px-3 py-1 mt-3 rounded-full inline-block font-medium";
      }
    }
  </script>
</body>
</html>`;
    } else if (msgLower.includes('clock') || msgLower.includes('stopwatch') || msgLower.includes('pomodoro') || msgLower.includes('timer') || msgLower.includes('time') || msgLower.includes('ghadi')) {
      resolvedProjectName = 'Swiss-Chronology Focus Hub';
      htmlCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Swiss ChronologyFocus Hub</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Outfit', sans-serif; background-color: #07090e; }
    .mono { font-family: 'JetBrains Mono', monospace; }
    .swiss-card { background: rgba(13, 17, 24, 0.85); border: 1px solid rgba(255, 255, 255, 0.05); }
  </style>
</head>
<body class="min-h-screen text-slate-100 p-4 md:p-8 flex justify-center items-center">
  <div class="w-full max-w-sm swiss-card rounded-3xl p-6 shadow-2xl relative overflow-hidden">
    <!-- Glow -->
    <div class="absolute top-0 right-0 w-24 h-24 bg-rose-500/10 blur-2xl rounded-full"></div>

    <!-- Mode Selector tabs -->
    <div class="flex bg-slate-900 rounded-2xl p-1 mb-8">
      <button onclick="setMode('clock')" id="tab-clock" class="flex-1 py-2 rounded-xl text-xs font-medium bg-rose-600 text-white transition-all">Clock</button>
      <button onclick="setMode('lap')" id="tab-lap" class="flex-1 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition-all">Stopwatch</button>
      <button onclick="setMode('pomo')" id="tab-pomo" class="flex-1 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition-all">Pomodoro</button>
    </div>

    <!-- CLOCK INTERFACE -->
    <div id="p-clock" class="text-center py-6">
      <div id="clock-display" class="text-5xl font-light font-mono text-white tracking-widest my-8">00:00:00</div>
      <p id="clock-date" class="text-[10px] tracking-widest text-slate-500 uppercase h-5 font-bold">THURSDAY, MAY 21</p>
    </div>

    <!-- STOPWATCH INTERFACE -->
    <div id="p-lap" class="hidden text-center py-6">
      <div id="lap-display" class="text-4xl font-light font-mono tracking-widest my-4">00:00.00</div>
      <div class="flex gap-2 justify-center my-4">
        <button onclick="toggleLap()" id="btn-lap-start" class="bg-rose-600 hover:bg-rose-500 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95">Start</button>
        <button onclick="recordLap()" class="bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95">Lap</button>
        <button onclick="resetLap()" class="bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95">Reset</button>
      </div>
      <div id="lap-records" class="text-left py-2 font-mono text-[10px] text-slate-400 space-y-1 h-20 overflow-y-auto mt-4 px-1">
        <!-- Lap records go here -->
      </div>
    </div>

    <!-- POMODORO INTERFACE -->
    <div id="p-pomo" class="hidden text-center py-6">
      <div id="pomo-display" class="text-5xl font-light font-mono tracking-widest my-4">25:00</div>
      <div class="flex gap-2 justify-center my-4">
        <button onclick="togglePomo()" id="btn-pomo-start" class="bg-rose-600 hover:bg-rose-500 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95">Start</button>
        <button onclick="resetPomo()" class="bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95">Reset</button>
      </div>
    </div>

  </div>

  <script>
    let activeMode = 'clock';

    setInterval(() => {
      const now = new Date();
      if (activeMode === 'clock') {
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        document.getElementById('clock-display').textContent = \`\${h}:\${m}:\${s}\`;
        
        const dateOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
        document.getElementById('clock-date').textContent = now.toLocaleDateString('en-IN', dateOptions);
      }
    }, 1000);

    function setMode(mode) {
      activeMode = mode;
      ['clock', 'lap', 'pomo'].forEach(m => {
        const pane = document.getElementById('p-' + m);
        const tab = document.getElementById('tab-' + m);
        if (m === mode) {
          pane.classList.remove('hidden');
          tab.className = 'flex-1 py-2 rounded-xl text-xs font-medium bg-rose-600 text-white transition-all';
        } else {
          pane.classList.add('hidden');
          tab.className = 'flex-1 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition-all';
        }
      });
    }

    let lapStart = 0;
    let lapInterval = null;
    let lapElapsed = 0;
    let lapCount = 1;

    function toggleLap() {
      const btn = document.getElementById('btn-lap-start');
      if (lapInterval) {
        clearInterval(lapInterval);
        lapInterval = null;
        btn.textContent = 'Start';
      } else {
        lapStart = Date.now() - lapElapsed;
        lapInterval = setInterval(() => {
          lapElapsed = Date.now() - lapStart;
          updateLapDisplay();
        }, 10);
        btn.textContent = 'Pause';
      }
    }

    function updateLapDisplay() {
      const ms = String(Math.floor((lapElapsed % 1000) / 10)).padStart(2, '0');
      const s = String(Math.floor((lapElapsed / 1000) % 60)).padStart(2, '0');
      const m = String(Math.floor(lapElapsed / 60000)).padStart(2, '0');
      document.getElementById('lap-display').textContent = \`\${m}:\${s}.\${ms}\`;
    }

    function recordLap() {
      if (!lapElapsed) return;
      const records = document.getElementById('lap-records');
      const timeStr = document.getElementById('lap-display').textContent;
      const div = document.createElement('div');
      div.className = "flex justify-between border-b border-white/5 pb-1";
      div.innerHTML = \`<span>LAP \${lapCount++}</span><span>\${timeStr}</span>\`;
      records.prepend(div);
    }

    function resetLap() {
      if (lapInterval) toggleLap();
      lapElapsed = 0;
      lapCount = 1;
      updateLapDisplay();
      document.getElementById('lap-records').innerHTML = '';
    }

    let pomoSeconds = 1500;
    let pomoInterval = null;

    function togglePomo() {
      const btn = document.getElementById('btn-pomo-start');
      if (pomoInterval) {
        clearInterval(pomoInterval);
        pomoInterval = null;
        btn.textContent = 'Start';
      } else {
        pomoInterval = setInterval(() => {
          if (pomoSeconds > 0) {
            pomoSeconds--;
            updatePomoDisplay();
          } else {
            clearInterval(pomoInterval);
            pomoInterval = null;
            btn.textContent = 'Start';
            alert('Timer Finished! Take a break.');
          }
        }, 1000);
        btn.textContent = 'Pause';
      }
    }

    function updatePomoDisplay() {
      const m = String(Math.floor(pomoSeconds / 60)).padStart(2, '0');
      const s = String(pomoSeconds % 60).padStart(2, '0');
      document.getElementById('pomo-display').textContent = \`\${m}:\${s}\`;
    }

    function resetPomo() {
      if (pomoInterval) togglePomo();
      pomoSeconds = 1500;
      updatePomoDisplay();
    }
  </script>
</body>
</html>`;
    } else if (msgLower.includes('note') || msgLower.includes('sticky') || msgLower.includes('bento') || msgLower.includes('board') || msgLower.includes('likh')) {
      resolvedProjectName = 'Bento Slate Sticky Notes';
      htmlCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bento Sticky Notes</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Outfit:wght@400;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background-color: #0c0f17; }
    .heading { font-family: 'Outfit', sans-serif; }
  </style>
</head>
<body class="min-h-screen text-slate-100 p-4 md:p-8">
  <div class="w-full max-w-4xl mx-auto">
    <!-- Header -->
    <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
      <div>
        <h1 class="heading text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <span class="w-3 h-3 bg-amber-400 rounded-full"></span> Bento Notes
        </h1>
        <p class="text-xs text-slate-400 mt-1">Scribble quick thoughts, ideas and items in a neat visual grid</p>
      </div>
      
      <button onclick="createNewNote()" class="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-2xl text-xs tracking-wide transition-all active:scale-95 flex items-center gap-1">
        + Create Sticky Note
      </button>
    </div>

    <!-- Notes Container Grid -->
    <div id="notes-grid" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
      <!-- Notes loaded dynamically -->
    </div>
  </div>

  <script>
    let notes = JSON.parse(localStorage.getItem('off_notes') || JSON.stringify([
      { id: 1, title: "Meeting Quick Notes", content: "Plan standard UI architecture modules for Next.js, make sure to write clean CSS, and check for responsive borders.", color: "amber" },
      { id: 2, title: "Fintech App Architecture", content: "Use PostgreSQL, auth via Firebase, double accounting LEDGER entries, state metrics cached inside Redis.", color: "indigo" },
      { id: 3, title: "Marketing Strategy Guidelines", content: "Draft nice scannable display cards, pair Space Grotesk with Inter fonts, and use absoluteNEGATIVE margins.", color: "rose" }
    ]));

    function save() {
      localStorage.setItem('off_notes', JSON.stringify(notes));
      render();
    }

    function createNewNote() {
      const titles = ["New Idea", "Daily Checklist", "Research Goals", "Quick Tasklist"];
      const colors = ["amber", "indigo", "rose", "emerald", "sky"];
      notes.push({
        id: Date.now(),
        title: titles[Math.floor(Math.random() * titles.length)],
        content: "Click to edit this custom sticky note content...",
        color: colors[Math.floor(Math.random() * colors.length)]
      });
      save();
    }

    function deleteNote(id) {
      notes = notes.filter(n => n.id !== id);
      save();
    }

    function updateNote(id, key, val) {
      notes = notes.map(n => n.id === id ? { ...n, [key]: val } : n);
      localStorage.setItem('off_notes', JSON.stringify(notes));
    }

    function render() {
      const grid = document.getElementById('notes-grid');
      grid.innerHTML = '';

      if (notes.length === 0) {
        grid.innerHTML = \`<div class="col-span-full text-center py-20 opacity-30 text-xs">Empty Workspace. Click '+ Create Sticky Note' above to add!</div>\`;
        return;
      }

      notes.forEach(note => {
        const item = document.createElement('div');
        const colorClasses = {
          amber: "border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 focus-within:border-amber-500",
          indigo: "border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/10 focus-within:border-indigo-500",
          rose: "border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 focus-within:border-rose-500",
          emerald: "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 focus-within:border-emerald-500",
          sky: "border-sky-500/20 bg-sky-500/5 hover:bg-sky-500/10 focus-within:border-sky-500",
        }[note.color] || "border-slate-800 bg-slate-950 hover:bg-slate-900";

        const textHeaderColor = {
          amber: "text-amber-400",
          indigo: "text-indigo-400",
          rose: "text-rose-400",
          emerald: "text-emerald-400",
          sky: "text-sky-400",
        }[note.color] || "text-white";

        item.className = \`p-5 rounded-2xl border transition-all relative overflow-hidden flex flex-col \  colorClasses}\`;
        item.style.minHeight = "160px";
        item.innerHTML = \`
          <div class="flex items-center justify-between mb-3">
            <input type="text" value="\${note.title}" oninput="updateNote(\${note.id}, 'title', this.value)"
              class="bg-transparent font-bold tracking-tight text-sm focus:outline-none focus:underline \${textHeaderColor} w-full truncate mr-4">
            <button onclick="deleteNote(\${note.id})" class="text-slate-500 hover:text-red-400 transition-colors p-1" title="DeleteNote">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
          <textarea oninput="updateNote(\${note.id}, 'content', this.value)"
            class="bg-transparent text-xs leading-relaxed text-slate-300 focus:outline-none resize-none flex-1 w-full" placeholder="Type notes content here...">\${note.content}</textarea>
        \`;
        grid.appendChild(item);
      });
    }

    render();
  </script>
</body>
</html>`;
    } else {
      const capitalizedName = message.replace(/[^a-zA-Z0-9\\s]/g, '').trim().split(' ').slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Cloud Portal';
      resolvedProjectName = capitalizedName;
      htmlCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${capitalizedName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Outfit', sans-serif; background-color: #080a10; }
    .mono { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="min-h-screen text-slate-100 flex flex-col">
  <header class="border-b border-slate-800 bg-[#0c0f17]/90 backdrop-blur px-6 py-4 flex items-center justify-between shrink-0 top-0 sticky z-50">
    <div class="flex items-center space-x-2">
      <div class="w-3 h-3 bg-indigo-500 rounded-full animate-pulse"></div>
      <h1 class="font-extrabold tracking-tight text-white text-md">${capitalizedName}</h1>
    </div>
    <div class="flex items-center space-x-3 text-xs">
      <span class="text-slate-400 inline-flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Heuristic Fallback App</span>
    </div>
  </header>

  <main class="flex-1 p-6 md:p-8 max-w-5xl mx-auto w-full space-y-6">
    <div class="p-6 rounded-2xl bg-indigo-950/20 border border-indigo-500/20 shadow-xl flex flex-col md:flex-row items-start gap-4">
      <div class="bg-indigo-600/10 p-3 rounded-2xl text-indigo-400 shrink-0">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
      </div>
      <div>
        <h2 class="font-bold text-sm tracking-tight text-indigo-300">Sovereign Proportional Mode Active</h2>
        <p class="text-xs text-slate-400 leading-relaxed mt-1">If your workspace API endpoints are missing, we dynamically compile high-speed functional interactive prototypes. You can create, edit and query records directly inside the sandbox locally.</p>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="bg-slate-900/40 border border-slate-800 p-5 rounded-2xl">
        <span class="block text-[10px] uppercase font-bold text-slate-500 tracking-wider">Workspace Database</span>
        <span id="badge-records" class="block font-mono text-3xl font-extrabold text-white mt-1">4 Records</span>
        <p class="text-[10px] text-slate-400 mt-2">Active records persisted locally inside client sessionStorage</p>
      </div>
      <div class="bg-indigo-500/5 border border-indigo-500/10 p-5 rounded-2xl">
        <span class="block text-[10px] uppercase font-bold text-slate-500 tracking-wider">Request Latency</span>
        <span class="block font-mono text-3xl font-extrabold text-indigo-400 mt-1">0 ms</span>
        <p class="text-[10px] text-slate-400 mt-2">Cached response processed natively on the sovereign container</p>
      </div>
      <div class="bg-emerald-500/5 border border-emerald-500/10 p-5 rounded-2xl">
        <span class="block text-[10px] uppercase font-bold text-slate-500 tracking-wider">Engine Efficiency</span>
        <span class="block font-mono text-3xl font-extrabold text-emerald-400 mt-1">100%</span>
        <p class="text-[10px] text-slate-400 mt-2">Safe Sandbox Environment active, avoiding external token expenditure</p>
      </div>
    </div>

    <div class="bg-slate-900/20 border border-slate-800 p-6 rounded-2xl">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h3 class="font-bold text-sm tracking-tight text-slate-100">Functional Records Console</h3>
          <p class="text-xs text-slate-400 mt-0.5">Persist dynamic items dynamically below</p>
        </div>
        
        <form onsubmit="addRecord(event)" class="flex gap-2 w-full md:w-auto">
          <input id="rec-input" type="text" placeholder="Entry Label..." required
            class="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 transition-all text-white max-w-[150px]">
          <button type="submit" class="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-xl text-xs tracking-wide transition-all active:scale-95">Add Node</button>
        </form>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs text-slate-300">
          <thead>
            <tr class="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
              <th class="py-3 px-4">Node ID</th>
              <th class="py-3 px-4">Entry Name</th>
              <th class="py-3 px-4">Operational Status</th>
              <th class="py-3 px-4 text-right">Settings</th>
            </tr>
          </thead>
          <tbody id="rec-table-body" class="divide-y divide-slate-800/40">
            <!-- Loaded dynamically -->
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <script>
    let records = JSON.parse(sessionStorage.getItem('off_recs') || JSON.stringify([
      { id: "NODE_1024", name: "${capitalizedName} Starter Frame", status: "Active" },
      { id: "NODE_2048", name: "System Pipeline Hook", status: "Connected" },
      { id: "NODE_4096", name: "Dynamic Token Guard", status: "Neutral" }
    ]));

    function save() {
      sessionStorage.setItem('off_recs', JSON.stringify(records));
      render();
    }

    function addRecord(e) {
      e.preventDefault();
      const input = document.getElementById('rec-input');
      const val = input.value.trim();
      if (!val) return;

      records.push({
        id: "NODE_" + Math.floor(Math.random() * 8999 + 1000),
        name: val,
        status: "Active"
      });
      input.value = '';
      save();
    }

    function deleteRecord(id) {
      records = records.filter(r => r.id !== id);
      save();
    }

    function render() {
      document.getElementById('badge-records').textContent = records.length + " Records";
      const body = document.getElementById('rec-table-body');
      body.innerHTML = '';

      if (records.length === 0) {
        body.innerHTML = \`<tr><td colspan="4" class="py-8 text-center text-slate-500">No active nodes in session ledger. Add some above!</td></tr>\`;
        return;
      }

      records.forEach(r => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-800/20";
        tr.innerHTML = \`
          <td class="py-3.5 px-4 font-mono text-[10px] text-slate-400">\0r.id}</td>
          <td class="py-3.5 px-4 font-medium text-slate-100">\0r.name}</td>
          <td class="py-3.5 px-4">
            <span class="inline-flex items-center gap-1 bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded-full text-[10px] font-semibold">
              <span class="w-1 h-1 bg-indigo-400 rounded-full"></span> \0r.status}
            </span>
          </td>
          <td class="py-3.5 px-4 text-right">
            <button onclick="deleteRecord('\0r.id}')" class="text-rose-500/80 hover:text-rose-400 font-bold transition-all">Remove</button>
          </td>
        \`;
        body.appendChild(tr);
      });
    }

    render();
  </script>
</body>
</html>`.replace(/\\0r/g, '${r');
    }

    const finalResponse = warningText + `I have generated a fully realized, responsive single-screen application for your request: **` + resolvedProjectName + `**.

Here is the code block that has been successfully deployed to your sandbox:

\`\`\`html
` + htmlCode + `
\`\`\`

You can preview and interact with this template immediately in the **Live Preview Panel**! Let me know if you would like me to modify any visual layout, elements, spacing, or actions.`;

    return finalResponse;
  }

  // Pipeline/Routing logic
