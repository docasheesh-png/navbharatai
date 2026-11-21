// Types of the generated character customizer module (CharacterCustomizerGenerator.ts), for its test only.
import type * as THREE from 'three';
export interface CharacterLook { colors: Record<string, string>; hidden: string[]; scale: number; role?: string }
export interface Handle { root: THREE.Object3D; play?(role: string, fadeSeconds?: number): boolean }
export declare function partsOf(root: THREE.Object3D): { materials: { name: string; color: string }[]; meshes: string[] };
export declare function applyLook(handle: Handle, look: Partial<CharacterLook> | null | undefined): void;
export declare function loadLook(id: string): CharacterLook | null;
export declare function openCharacterCustomizer(handle: Handle, options: { id: string; roles?: string[]; labels?: Record<string, string> }): { close(): void; look(): CharacterLook };
