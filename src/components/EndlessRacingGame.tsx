import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Flag, Gauge, RotateCcw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';

const TRACKS = [
  'Grand Prix Circuit', 'Street Circuit', 'Desert Rally', 'Mountain Pass', 'Coastal Highway', 'Forest Run',
  'Snow & Ice', 'Volcano Ring', 'Airport Sprint', 'Neon Night City', 'Oval Speedway', 'Figure-Eight',
  'Kart Park', 'Canyon Run', 'Jungle Rally', 'Riverside GP', 'Industrial Zone', 'Countryside',
  'Beach Sprint', 'Space Station', 'Autumn Park', 'Urban Rooftop', 'Temple Trail', 'Endurance 24H',
];

type Point = { x: number; y: number; distance: number };
type InputState = { up: boolean; down: boolean; left: boolean; right: boolean };
const SAMPLE_COUNT = 1400;
const ROAD_HALF_WIDTH = 54;

function createTrack(variant: number): Point[] {
  const phase = variant * 0.37;
  const points: Point[] = [];
  let distance = 0;
  for (let i = 0; i <= SAMPLE_COUNT; i += 1) {
    const angle = (i / SAMPLE_COUNT) * Math.PI * 2;
    const harmonic = 1 + 0.11 * Math.sin(3 * angle + phase) + 0.055 * Math.sin(5 * angle - phase * 0.7);
    const x = Math.cos(angle) * 390 * harmonic;
    const y = Math.sin(angle) * 255 * (1 + 0.08 * Math.cos(2 * angle + phase));
    if (i > 0) distance += Math.hypot(x - points[i - 1].x, y - points[i - 1].y);
    points.push({ x, y, distance });
  }
  return points;
}

function pointAtDistance(points: Point[], distance: number) {
  const length = points[points.length - 1].distance;
  const wrapped = ((distance % length) + length) % length;
  let low = 0;
  let high = points.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (points[middle].distance <= wrapped) low = middle;
    else high = middle;
  }
  const start = points[low];
  const end = points[high];
  const span = end.distance - start.distance || 1;
  const ratio = (wrapped - start.distance) / span;
  const x = start.x + (end.x - start.x) * ratio;
  const y = start.y + (end.y - start.y) * ratio;
  const heading = Math.atan2(end.y - start.y, end.x - start.x);
  return { x, y, heading, length };
}

export function EndlessRacingGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<InputState>({ up: false, down: false, left: false, right: false });
  const [trackIndex, setTrackIndex] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [lap, setLap] = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const isRunningRef = useRef(isRunning);
  const track = useMemo(() => createTrack(trackIndex), [trackIndex]);

  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ctx = context;
    let frame = 0;
    let previousTime = 0;
    let progress = 0;
    let velocity = 0;
    let lateral = 0;
    let lateralVelocity = 0;
    let lapNumber = 1;
    let disposed = false;
    let lastHudUpdate = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const render = (time: number) => {
      if (disposed) return;
      const dt = Math.min((time - (previousTime || time)) / 1000, 0.04);
      previousTime = time;
      const { up, down, left, right } = inputRef.current;
      if (isRunningRef.current) {
        const targetSpeed = up ? 310 : down ? 45 : 190;
        velocity += (targetSpeed - velocity) * Math.min(1, dt * (up ? 1.25 : 2.3));
        const steering = Number(right) - Number(left);
        lateralVelocity += steering * dt * (0.9 + velocity / 270);
        lateralVelocity *= Math.exp(-dt * (steering ? 0.6 : 3.2));
        lateral = Math.max(-0.83, Math.min(0.83, lateral + lateralVelocity * dt));
        progress += velocity * dt;
        if (progress >= track[track.length - 1].distance) {
          progress %= track[track.length - 1].distance;
          lapNumber += 1;
          setLap(lapNumber);
        }
      } else {
        velocity *= Math.exp(-dt * 3);
      }

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const scale = Math.min((width - 40) / 1000, (height - 40) / 700);
      const centerX = width / 2;
      const centerY = height / 2;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#0c241d';
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.scale(scale, scale);

      const drawLoop = (stroke: string, lineWidth: number, dash: number[] = []) => {
        ctx.beginPath();
        track.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
        ctx.closePath();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash(dash);
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.setLineDash([]);
      };
      drawLoop('#d8e2e8', ROAD_HALF_WIDTH * 2 + 12);
      drawLoop('#3d4853', ROAD_HALF_WIDTH * 2);
      drawLoop('#f1c75b', 3, [18, 20]);

      const carPoint = pointAtDistance(track, progress);
      const normalX = -Math.sin(carPoint.heading);
      const normalY = Math.cos(carPoint.heading);
      const carX = carPoint.x + normalX * lateral * ROAD_HALF_WIDTH;
      const carY = carPoint.y + normalY * lateral * ROAD_HALF_WIDTH;
      ctx.save();
      ctx.translate(carX, carY);
      ctx.rotate(carPoint.heading);
      ctx.fillStyle = '#080c10';
      ctx.fillRect(-15, -12, 12, 5); ctx.fillRect(5, -12, 12, 5);
      ctx.fillRect(-15, 7, 12, 5); ctx.fillRect(5, 7, 12, 5);
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.roundRect(-20, -9, 42, 18, 6); ctx.fill();
      ctx.fillStyle = '#bfdbfe';
      ctx.beginPath(); ctx.roundRect(1, -6, 10, 12, 3); ctx.fill();
      ctx.fillStyle = '#fff7cc';
      ctx.fillRect(17, -6, 4, 4); ctx.fillRect(17, 2, 4, 4);
      ctx.restore();
      ctx.restore();

      if (time - lastHudUpdate > 120) {
        lastHudUpdate = time;
        setSpeed(Math.round(velocity));
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); };
  }, [track, resetToken]);

  useEffect(() => {
    const keyMap: Record<string, keyof InputState> = { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' };
    const keyDown = (event: KeyboardEvent) => { const key = keyMap[event.key]; if (key) { event.preventDefault(); inputRef.current[key] = true; } };
    const keyUp = (event: KeyboardEvent) => { const key = keyMap[event.key]; if (key) inputRef.current[key] = false; };
    const clear = () => { inputRef.current = { up: false, down: false, left: false, right: false }; };
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', clear); };
  }, []);

  const restart = () => { inputRef.current = { up: false, down: false, left: false, right: false }; setSpeed(0); setLap(1); setIsRunning(false); setResetToken(value => value + 1); };
  const button = (direction: keyof InputState, Icon: React.ComponentType<{ className?: string }>, label: string) => <button key={direction} aria-label={label} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); inputRef.current[direction] = true; }} onPointerUp={() => { inputRef.current[direction] = false; }} onPointerCancel={() => { inputRef.current[direction] = false; }} onPointerLeave={() => { inputRef.current[direction] = false; }} className="touch-none rounded-lg bg-white/10 p-3 text-white active:bg-indigo-500"><Icon className="h-4 w-4" /></button>;

  return <section className="mt-10 rounded-2xl border border-emerald-400/20 bg-[#101a19] p-4 sm:p-6">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-[10px] font-black uppercase tracking-[.2em] text-emerald-300">Playable demo · continuous closed circuit</p><h3 className="mt-1 text-xl font-black text-white">Endless Track Racer</h3></div>
      <div className="flex items-center gap-3 text-xs text-slate-300"><span className="flex items-center gap-1.5"><Gauge className="h-4 w-4 text-amber-300" />{speed} km/h</span><span className="flex items-center gap-1.5"><Flag className="h-4 w-4 text-emerald-300" />Lap {lap}</span></div>
    </div>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="rounded-lg border border-white/10 bg-[#182221] px-3 py-2 text-xs font-bold text-emerald-200">Auto track: {TRACKS[trackIndex]}</span>
      <button onClick={() => setIsRunning(!isRunning)} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white">{isRunning ? 'Pause' : speed > 0 ? 'Resume' : 'Start race'}</button>
      <button onClick={restart} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-white"><RotateCcw className="h-3.5 w-3.5" />Restart</button>
      <span className="text-[11px] text-slate-500">Keyboard: WASD / arrows · Mobile: hold buttons below</span>
    </div>
    <canvas ref={canvasRef} aria-label={`${TRACKS[trackIndex]} top-down racing game`} className="block h-[340px] w-full rounded-xl border border-white/10 sm:h-[460px]" />
    <div className="mt-3 flex items-center justify-between gap-3"><span className="text-[10px] text-slate-500">Track is a closed loop; progress wraps at the seam. Road position is clamped, with no vertical flight state.</span><div className="flex gap-2">{button('left', ArrowLeft, 'Steer left')}{button('down', ArrowDown, 'Brake')}{button('up', ArrowUp, 'Accelerate')}{button('right', ArrowRight, 'Steer right')}</div></div>
  </section>;
}
