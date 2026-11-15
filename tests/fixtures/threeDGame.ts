// A representative saved 3D game: multiple scenes, assets, controls, camera and collision code, an engine
// dependency. Small enough for a unit test, shaped like what the builder writes for "a 3D city game".
export const GAME_BRIEF = 'Build a realistic 3D city driving game. It must always keep first-person controls on WASD, and never remove the three loaded scenes.';

export function cityGame(): Record<string, string> {
  return {
    'package.json': JSON.stringify({ name: 'city', dependencies: { react: '^18', three: '^0.160', '@react-three/fiber': '^8', '@react-three/drei': '^9', '@react-three/rapier': '^1' } }),
    'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
    'src/main.tsx': 'import React from "react";import ReactDOM from "react-dom/client";import App from "./App";ReactDOM.createRoot(document.getElementById("root")!).render(<App/>);',
    'src/App.tsx': 'import { Canvas } from "@react-three/fiber";import CityScene from "./scenes/CityScene";import HarborScene from "./scenes/HarborScene";import AirportScene from "./scenes/AirportScene";import { PlayerCar } from "./game/PlayerCar";import { CameraRig } from "./game/CameraRig";import { useGameSettings } from "./game/settings";\nexport default function App(){const s=useGameSettings();return <Canvas><CameraRig mode={s.cameraMode}/><CityScene/><HarborScene/><AirportScene/><PlayerCar/></Canvas>}',
    'src/scenes/CityScene.tsx': 'import { useGLTF } from "@react-three/drei";export default function CityScene(){const m=useGLTF("/models/city.glb");return <primitive object={m.scene}/>}',
    'src/scenes/HarborScene.tsx': 'import { useGLTF } from "@react-three/drei";export default function HarborScene(){const m=useGLTF("/models/harbor.glb");return <primitive object={m.scene}/>}',
    'src/scenes/AirportScene.tsx': 'import { useGLTF } from "@react-three/drei";export default function AirportScene(){const m=useGLTF("/models/airport.glb");return <primitive object={m.scene}/>}',
    'src/game/PlayerCar.tsx': 'import { useKeyboard } from "./controls";export function PlayerCar(){const k=useKeyboard();return <mesh position={[0,0,0]}/>}',
    'src/game/controls.ts': 'export function useKeyboard(){return {w:false,a:false,s:false,d:false}}',
    'src/game/CameraRig.tsx': 'export function CameraRig({mode}:{mode:"first"|"third"}){return null}',
    'src/game/collision.ts': 'export function collides(a:number,b:number){return Math.abs(a-b)<1}',
    'src/game/settings.ts': 'export function useGameSettings(){return {cameraMode:"first" as const}}',
    'public/models/city.glb': 'GLB-CITY-BYTES',
    'public/models/harbor.glb': 'GLB-HARBOR-BYTES',
    'public/models/airport.glb': 'GLB-AIRPORT-BYTES',
  };
}

/** A totally different game that renders just fine: the incident's shape. */
export function differentGame(): Record<string, string> {
  return {
    'package.json': JSON.stringify({ name: 'snake', dependencies: { react: '^18' } }),
    'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
    'src/main.tsx': 'import React from "react";import ReactDOM from "react-dom/client";import Snake from "./Snake";ReactDOM.createRoot(document.getElementById("root")!).render(<Snake/>);',
    'src/Snake.tsx': 'export default function Snake(){return <canvas width={400} height={400}/>}',
    'src/App.tsx': 'import Snake from "./Snake";export default function App(){return <Snake/>}',
  };
}
