// Ambient module declarations — used when node_modules is absent (CI containers).
// When npm install is run, TypeScript uses the real package types instead.

// Build-time stamp injected by Vite's `define` (see vite.config.ts).
declare const __BUILD_TIME__: string;

// React namespace — allows React.FC, React.useRef, React.FormEvent etc. in type positions
declare namespace React {
  function useState<T = any>(init?: T | (() => T)): [T, (v: T | ((p: T) => T)) => void];
  function useEffect(effect: () => any, deps?: readonly any[]): void;
  function useLayoutEffect(effect: () => any, deps?: readonly any[]): void;
  function useRef<T = any>(init?: T | null): { current: T | null };
  function useCallback<T extends (...a: any[]) => any>(cb: T, deps?: readonly any[]): T;
  function useMemo<T = any>(factory: () => T, deps?: readonly any[]): T;
  function useContext<T = any>(ctx: any): T;
  function useReducer<S = any, A = any>(r: any, init: S, initFn?: any): [S, (a: A) => void];
  function useId(): string;
  function useImperativeHandle(ref: any, init: () => any, deps?: readonly any[]): void;
  function createContext<T = any>(defaultValue?: T): any;
  function forwardRef<T = any, P = any>(render: (props: P, ref: any) => any): any;
  function memo<T = any>(c: T, eq?: (a: any, b: any) => boolean): T;
  function createRef<T = any>(): RefObject<T>;
  function lazy<T>(factory: () => Promise<{ default: T }>): T;
  function createElement(type: any, props?: any, ...children: any[]): ReactElement;
  function cloneElement(element: any, props?: any, ...children: any[]): ReactElement;
  function isValidElement(obj: any): boolean;
  const Fragment: any;
  const StrictMode: any;
  const Suspense: any;
  const Children: any;
  const version: string;
  class Component<P = any, S = any> {
    constructor(props: P);
    props: P;
    state: S;
    setState(state: Partial<S> | ((prev: S) => Partial<S>), cb?: () => void): void;
    forceUpdate(cb?: () => void): void;
    render(): ReactNode;
    componentDidMount?(): void;
    componentDidUpdate?(prevProps: P, prevState: S): void;
    componentWillUnmount?(): void;
    componentDidCatch?(error: Error, info: ErrorInfo): void;
  }
  class PureComponent<P = any, S = any> extends Component<P, S> {}
  type ErrorInfo = { componentStack: string };
  type FC<P = any> = (props: P & { children?: ReactNode }) => ReactElement | null;
  type FunctionComponent<P = any> = FC<P>;
  type VFC<P = any> = (props: P) => ReactElement | null;
  type ReactNode = ReactElement | string | number | boolean | null | undefined | ReactNode[];
  type ReactElement = { type: any; props: any; key: any };
  type Ref<T = any> = RefObject<T> | ((val: T | null) => void) | null;
  type RefObject<T = any> = { readonly current: T | null };
  type MutableRefObject<T = any> = { current: T };
  type CSSProperties = { [key: string]: string | number | undefined | null };
  type Dispatch<A = any> = (a: A) => void;
  type SetStateAction<S = any> = S | ((prev: S) => S);
  type ChangeEvent<T = any> = any;
  type MouseEvent<T = any, E = any> = any;
  type KeyboardEvent<T = any> = any;
  type FormEvent<T = any> = any;
  type FocusEvent<T = any, R = any> = any;
  type DragEvent<T = any> = any;
  type WheelEvent<T = any> = any;
  type ClipboardEvent<T = any> = any;
  type TouchEvent<T = any> = any;
  type PointerEvent<T = any> = any;
  type SyntheticEvent<T = any, E = any> = any;
  type PropsWithChildren<P = any> = P & { children?: ReactNode };
  type ComponentProps<T = any> = any;
  type ComponentType<P = any> = FC<P> | (new (props: P) => any);
  type ElementType<P = any> = string | ComponentType<P>;
  type ElementRef<T = any> = any;
  type EventHandler<E = any> = (e: E) => void;
  type HTMLAttributes<T = any> = any;
  type ImgHTMLAttributes<T = any> = any;
  type InputHTMLAttributes<T = any> = any;
  type TextareaHTMLAttributes<T = any> = any;
  type ButtonHTMLAttributes<T = any> = any;
  type FormHTMLAttributes<T = any> = any;
  type AnchorHTMLAttributes<T = any> = any;
  type SelectHTMLAttributes<T = any> = any;
  type SVGProps<T = any> = any;
  type Context<T = any> = any;
  type Provider<T = any> = FC<{ value: T; children?: ReactNode }>;
}

declare module 'react' {
  export = React;
  export as namespace React;
}

// Global JSX namespace — lets TypeScript handle key, ref, and HTML elements in JSX
declare namespace JSX {
  type Element = React.ReactElement;
  interface ElementClass { render(): React.ReactNode; }
  interface ElementAttributesProperty { props: {}; }
  interface ElementChildrenAttribute { children: {}; }
  interface IntrinsicAttributes { key?: string | number | null; ref?: any; }
  interface IntrinsicClassAttributes<T> { ref?: React.Ref<T>; }
  interface IntrinsicElements { [elemName: string]: any; }
}

declare module 'react/jsx-runtime';
declare module 'react/jsx-dev-runtime';
declare module 'react-dom';
declare module 'react-dom/client' {
  export function createRoot(container: Element | DocumentFragment, opts?: any): { render(el: any): void; unmount(): void };
}

declare module 'react-markdown';
declare module 'motion/react';
declare module 'axios';
declare module 'clsx' {
  export type ClassValue = string | number | boolean | null | undefined | ClassValue[] | Record<string, any>;
  export function clsx(...inputs: ClassValue[]): string;
  export default clsx;
}
declare module 'tailwind-merge' {
  export function twMerge(...inputs: string[]): string;
  export default twMerge;
}
declare module 'uuid';
declare module 'xterm' {
  export interface ITerminalOptions { [key: string]: any; }
  export class Terminal {
    constructor(options?: ITerminalOptions);
    open(container: HTMLElement): void;
    write(data: string | Uint8Array): void;
    writeln(data: string): void;
    clear(): void;
    dispose(): void;
    reset(): void;
    loadAddon(addon: any): void;
    onData(callback: (data: string) => void): { dispose: () => void };
    focus(): void;
    blur(): void;
    onKey(callback: (e: { key: string; domEvent: KeyboardEvent }) => void): { dispose: () => void };
    onResize(callback: (size: { cols: number; rows: number }) => void): { dispose: () => void };
    cols: number;
    rows: number;
    element: HTMLElement | undefined;
    textarea: HTMLTextAreaElement | undefined;
  }
}
declare module 'xterm-addon-fit' {
  import { Terminal } from 'xterm';
  export class FitAddon {
    activate(terminal: Terminal): void;
    dispose(): void;
    fit(): void;
    proposeDimensions(): { cols: number; rows: number } | undefined;
  }
}
declare module 'xterm/css/xterm.css' {}
declare module '@monaco-editor/react';

// lucide-react — all icons used across the codebase
declare module 'lucide-react' {
  type LucideProps = {
    size?: number | string;
    className?: string;
    strokeWidth?: number | string;
    color?: string;
    style?: any;
    onClick?: (e: any) => void;
    title?: string;
    [key: string]: any;
  };
  type Icon = import('react').FC<LucideProps>;
  export const Activity: Icon;
  export const AlertCircle: Icon;
  export const AlertTriangle: Icon;
  export const AlignCenter: Icon;
  export const AlignJustify: Icon;
  export const AlignLeft: Icon;
  export const AlignRight: Icon;
  export const ArrowRight: Icon;
  export const ArrowUpRight: Icon;
  export const BarChart2: Icon;
  export const Bold: Icon;
  export const Bot: Icon;
  export const Bug: Icon;
  export const Camera: Icon;
  export const Check: Icon;
  export const CheckCircle2: Icon;
  export const ChevronDown: Icon;
  export const ChevronLeft: Icon;
  export const ChevronRight: Icon;
  export const ChevronUp: Icon;
  export const Circle: Icon;
  export const ClipboardList: Icon;
  export const Clock: Icon;
  export const Cloud: Icon;
  export const Code: Icon;
  export const Code2: Icon;
  export const Coins: Icon;
  export const Command: Icon;
  export const Compass: Icon;
  export const Copy: Icon;
  export const CornerDownLeft: Icon;
  export const Cpu: Icon;
  export const CreditCard: Icon;
  export const Database: Icon;
  export const Disc: Icon;
  export const Download: Icon;
  export const Edit2: Icon;
  export const ExternalLink: Icon;
  export const Eye: Icon;
  export const EyeOff: Icon;
  export const Flag: Icon;
  export const Github: Icon;
  export const Globe: Icon;
  export const Hammer: Icon;
  export const Heart: Icon;
  export const HeartHandshake: Icon;
  export const HelpCircle: Icon;
  export const History: Icon;
  export const Home: Icon;
  export const IndianRupee: Icon;
  export const Italic: Icon;
  export const Languages: Icon;
  export const Layers: Icon;
  export const Link: Icon;
  export const LinkIcon: Icon;
  export const ListMusic: Icon;
  export const ListTree: Icon;
  export const Loader2: Icon;
  export const Lock: Icon;
  export const LogIn: Icon;
  export const LogOut: Icon;
  export const Mail: Icon;
  export const Maximize2: Icon;
  export const Menu: Icon;
  export const MessageSquare: Icon;
  export const Mic: Icon;
  export const MicOff: Icon;
  export const Minimize2: Icon;
  export const Monitor: Icon;
  export const MoreVertical: Icon;
  export const MousePointer2: Icon;
  export const Music: Icon;
  export const Package: Icon;
  export const Palette: Icon;
  export const PanelRight: Icon;
  export const PanelRightClose: Icon;
  export const Pause: Icon;
  export const Pen: Icon;
  export const Play: Icon;
  export const Plus: Icon;
  export const QrCode: Icon;
  export const RefreshCcw: Icon;
  export const Rocket: Icon;
  export const RotateCcw: Icon;
  export const Save: Icon;
  export const Search: Icon;
  export const Send: Icon;
  export const Settings: Icon;
  export const Share2: Icon;
  export const Shield: Icon;
  export const ShieldAlert: Icon;
  export const ShieldCheck: Icon;
  export const ShoppingBag: Icon;
  export const ShoppingCart: Icon;
  export const SkipBack: Icon;
  export const SkipForward: Icon;
  export const Smartphone: Icon;
  export const Sparkles: Icon;
  export const Star: Icon;
  export const Tablet: Icon;
  export const Terminal: Icon;
  export const TerminalSquare: Icon;
  export const ThumbsDown: Icon;
  export const ThumbsUp: Icon;
  export const Trash2: Icon;
  export const Type: Icon;
  export const Unlock: Icon;
  export const User: Icon;
  export const Volume2: Icon;
  export const Wifi: Icon;
  export const X: Icon;
  export const Zap: Icon;
  export const ZapIcon: Icon;
  export const RefreshCw: Icon;
  // Additional icons
  export const ArrowDown: Icon;
  export const ArrowLeft: Icon;
  export const ArrowUp: Icon;
  export const ArrowUpCircle: Icon;
  export const Baby: Icon;
  export const Bell: Icon;
  export const BookOpen: Icon;
  export const Box: Icon;
  export const CheckSquare: Icon;
  export const Columns: Icon;
  export const Eraser: Icon;
  export const FileCode: Icon;
  export const FileJson: Icon;
  export const FilePlus: Icon;
  export const FileSearch: Icon;
  export const FileText: Icon;
  export const Files: Icon;
  export const Folder: Icon;
  export const FolderOpen: Icon;
  export const FolderPlus: Icon;
  export const Gamepad2: Icon;
  export const Gift: Icon;
  export const GitBranch: Icon;
  export const GitCommit: Icon;
  export const GitFork: Icon;
  export const GitMerge: Icon;
  export const GitPullRequest: Icon;
  export const HardDrive: Icon;
  export const Image: Icon;
  export const Info: Icon;
  export const Key: Icon;
  export const Keyboard: Icon;
  export const Layout: Icon;
  export const LayoutDashboard: Icon;
  export const LayoutGrid: Icon;
  export const List: Icon;
  export const MoreHorizontal: Icon;
  export const Move: Icon;
  export const Navigation: Icon;
  export const Paperclip: Icon;
  export const Pill: Icon;
  export const Puzzle: Icon;
  export const Server: Icon;
  export const Stethoscope: Icon;
  export const TestTube: Icon;
  export const Trophy: Icon;
  export const Tv: Icon;
  export const Upload: Icon;
  export const UploadCloud: Icon;
  export const UserPlus: Icon;
  export const Wallet: Icon;
  export const Workflow: Icon;
  export const Calculator: Icon;
  export const Webhook: Icon;
  export const Clipboard: Icon;
  export const Briefcase: Icon;
  export const HardHat: Icon;
  export const Scale: Icon;
  export const GraduationCap: Icon;
  export const Building2: Icon;
  export const GripVertical: Icon;
  export const Pencil: Icon;
  export const Lightbulb: Icon;
  export const BarChart: Icon;
  export const PieChart: Icon;
  export const TrendingUp: Icon;
  export const FileCode2: Icon;
  export const Maximize: Icon;
  export const Minimize: Icon;
  export const StopCircle: Icon;
  export const ToggleLeft: Icon;
  export const ToggleRight: Icon;
  export const Flame: Icon;
  export const Server2: Icon;
  export const CloudLightning: Icon;
  export const TrendingDown: Icon;
  export const Users: Icon;
  export const HardDriveDownload: Icon;
  export const Cpu2: Icon;
  export const Wand2: Icon;
  export const MessageCircle: Icon;
  export const Network: Icon;
  export const DollarSign: Icon;
  export const Radio: Icon;
  export const Zap2: Icon;
  export const Blocks: Icon;
  export const CircleDot: Icon;
  export const Gauge: Icon;
  export const Wand: Icon;
  export const Anchor: Icon;
  export const Square: Icon;
  export const MousePointerClick: Icon;
  export const CreditCard2: Icon;
  export const Table: Icon;
  export const Table2: Icon;
  export const Tag: Icon;
  export const Map: Icon;
  export const MapPin: Icon;
  export const Sitemap: Icon;
  export const FileJson2: Icon;
  export const Braces: Icon;
  export const SquareCode: Icon;
  export const ArrowDownRight: Icon;
  export const MoveRight: Icon;
  export const Route: Icon;
  export const BotMessageSquare: Icon;
  export const MousePointer: Icon;
  export const Crosshair: Icon;
  export const Sliders: Icon;
  export const SlidersHorizontal: Icon;
  export const Figma: Icon;
  export const Users2: Icon;
  export const Sun: Icon;
  export const Megaphone: Icon;
  export const BadgeIndianRupee: Icon;
  export const Banknote: Icon;
  export const Repeat: Icon;
  export const Moon: Icon;
  export const PaintBucket: Icon;
  export const Minimize2: Icon;
  export const Maximize2: Icon;
  export const SunMoon: Icon;
  export const Contrast: Icon;
  export const Palette2: Icon;
  export const UserCheck: Icon;
  export const UserX: Icon;
  export const Crown: Icon;
  export const Link2: Icon;
  export const Signal: Icon;
  export const Globe2: Icon;
  export const PackageOpen: Icon;
  export const FolderDown: Icon;
  export const ArrowUpRight: Icon;
  export const Edit3: Icon;
  export const UserMinus: Icon;
  export const Video: Icon;
  export const Users: Icon;
  export const Wifi: Icon;
  export const MoreVertical: Icon;
  export const Store: Icon;
  export const AppWindow: Icon;
  export const ImagePlus: Icon;
  export const Sparkle: Icon;
  export const Timer: Icon;
  export const FileDiff: Icon;
  export const GitGraph: Icon;
  export const Milestone: Icon;
  export const ListChecks: Icon;
  export const BadgeCheck: Icon;
  export const BarChart: Icon;
  export const LineChart: Icon;
  export const Apple: Icon;
  export const Leaf: Icon;
  export const PawPrint: Icon;
  export const Umbrella: Icon;
  export const ChefHat: Icon;
  export const Flower2: Icon;
  export const Sprout: Icon;
  export const Car: Icon;
  export const Dog: Icon;
  export const Gem: Icon;
  export const PartyPopper: Icon;
  export const Sofa: Icon;
  export const HandHelping: Icon;
  export const Shirt: Icon;
  export const Wrench: Icon;
  export const CandlestickChart: Icon;
  export const Sigma: Icon;
  export const BriefcaseMedical: Icon;
  export const TreePine: Icon;
  export const ScrollText: Icon;
  export const Brain: Icon;
  export const Bird: Icon;
  export const Laptop: Icon;
  export const Droplets: Icon;
  export const Telescope: Icon;
  export const PersonStanding: Icon;
  export const Mountain: Icon;
  export const PiggyBank: Icon;
  export const PlayCircle: Icon;
  export const Hash: Icon;
  export const AtSign: Icon;
  export const UserCircle: Icon;
  export const ScreenShare: Icon;
  export const PenLine: Icon;
  export const FlaskConical: Icon;
  export const ShieldAlert: Icon;
  export const Lightbulb: Icon;
  export const Accessibility: Icon;
  export const ClipboardCheck: Icon;
  export const FileCheck2: Icon;
  export const Translate: Icon;
  export const FlagTriangleRight: Icon;
  export const MessageCircleCode: Icon;
  export const Diff: Icon;
  export const Strikethrough: Icon;
  export const CheckCheck: Icon;
  export const Paintbrush: Icon;
  export const Brush: Icon;
  export const Filter: Icon;
  export const Kanban: Icon;
  export const CalendarDays: Icon;
  export const Target: Icon;
  export const CloudUpload: Icon;
  export const ServerCog: Icon;
  export const CloudCog: Icon;
  export const CloudCheck: Icon;
  export const LayoutTemplate: Icon;
  export const HeartPulse: Icon;
  export const Award: Icon;
  export const ChartGantt: Icon;
  export const Satellite: Icon;
  export const Radio: Icon;
  export const MapPin: Icon;
  export const ArrowUpDown: Icon;
  export const SortAsc: Icon;
  export const SortDesc: Icon;
  export const TableProperties: Icon;
  export const PanelLeft: Icon;
  export const PanelRight: Icon;
  export const RowsIcon: Icon;
  export const Braces: Icon;
  export const CirclePlay: Icon;
  export const CircleStop: Icon;
  export const CircleCheck: Icon;
  export const Hammer: Icon;
  export const PackagePlus: Icon;
  export const PackageX: Icon;
  export const ToggleOn: Icon;
  export const Pipette: Icon;
  export const Type: Icon;
  export const Italic: Icon;
  export const Bold: Icon;
  export const Underline: Icon;
}

declare module 'firebase/app' {
  export function initializeApp(config: any, name?: string): any;
  export function getApp(name?: string): any;
  export function getApps(): any[];
  export type FirebaseApp = any;
  export type FirebaseOptions = any;
}
declare module 'firebase/auth' {
  export function getAuth(app?: any): any;
  export function onAuthStateChanged(auth: any, cb: (user: any) => void): () => void;
  export function signInWithEmailAndPassword(auth: any, email: string, password: string): Promise<any>;
  export function createUserWithEmailAndPassword(auth: any, email: string, password: string): Promise<any>;
  export function signOut(auth: any): Promise<void>;
  export function sendPasswordResetEmail(auth: any, email: string): Promise<void>;
  export function updateProfile(user: any, profile: any): Promise<void>;
  export const GoogleAuthProvider: any;
  export const GithubAuthProvider: any;
  export function signInWithPopup(auth: any, provider: any): Promise<any>;
  export function signInWithRedirect(auth: any, provider: any): Promise<any>;
  export function signInWithCredential(auth: any, credential: any): Promise<any>;
  export function getRedirectResult(auth: any): Promise<any>;
  export function fetchSignInMethodsForEmail(auth: any, email: string): Promise<string[]>;
  export function linkWithCredential(user: any, credential: any): Promise<any>;
  export type AuthProvider = any;
  export function signInWithPhoneNumber(auth: any, phone: string, verifier: any): Promise<any>;
  export function setPersistence(auth: any, persistence: any): Promise<void>;
  export function initializeAuth(app: any, deps?: any): any;
  export const browserLocalPersistence: any;
  export const browserSessionPersistence: any;
  export const indexedDBLocalPersistence: any;
  export const inMemoryPersistence: any;
  export class RecaptchaVerifier {
    constructor(auth: any, container: any, params?: any);
    verify(): Promise<string>;
    clear(): void;
    render(): Promise<number>;
  }
  export class ConfirmationResult {
    confirm(code: string): Promise<any>;
    verificationId: string;
  }
  export type User = any;
  export type UserCredential = any;
  export type Auth = any;
  export type Persistence = any;
}
declare module '*.css' {}
declare module '*.svg' { const content: string; export default content; }
declare module '*.png' { const content: string; export default content; }

declare module 'firebase/firestore' {
  export function getFirestore(app?: any, databaseId?: string): any;
  export function collection<T = any>(db: any, ...path: string[]): any;
  export function doc<T = any>(ref: any, ...path: string[]): any;
  export function getDoc<T = any>(ref: any): Promise<any>;
  export function getDocs<T = any>(query: any): Promise<any>;
  export function setDoc(ref: any, data: any, opts?: any): Promise<void>;
  export function updateDoc(ref: any, data: any): Promise<void>;
  export function deleteDoc(ref: any): Promise<void>;
  export function addDoc<T = any>(ref: any, data: any): Promise<any>;
  export function query<T = any>(ref: any, ...constraints: any[]): any;
  export function where(field: string, op: string, value: any): any;
  export function orderBy(field: string, dir?: 'asc' | 'desc'): any;
  export function limit(n: number): any;
  export function onSnapshot(ref: any, cb: (snap: any) => void, err?: (e: any) => void): () => void;
  export function serverTimestamp(): any;
  export const Timestamp: any;
  export function arrayUnion(...items: any[]): any;
  export function arrayRemove(...items: any[]): any;
  export function increment(n: number): any;
  export function writeBatch(db: any): any;
  export function runTransaction<T = any>(db: any, cb: (tx: any) => Promise<T>): Promise<T>;
  export function startAfter(...fieldValues: any[]): any;
  export function startAt(...fieldValues: any[]): any;
  export function endBefore(...fieldValues: any[]): any;
  export function endAt(...fieldValues: any[]): any;
  export type DocumentData = any;
  export type QuerySnapshot<T = any> = any;
  export type DocumentSnapshot<T = any> = any;
  export type Firestore = any;
  export type CollectionReference<T = any> = any;
  export type DocumentReference<T = any> = any;
  export type Query<T = any> = any;
  export type FieldValue = any;
  export type QueryDocumentSnapshot<T = any> = any;
}
declare module 'firebase/storage';
declare module 'firebase/functions';
declare module 'firebase-admin';
declare module '@google/genai';
declare module '@google-cloud/vertexai';
declare module '@anthropic-ai/sdk';
declare module 'simple-git';
declare module 'typescript';
declare module 'express';
declare module 'cashfree-pg';
declare module 'dotenv/config';
declare module 'cheerio';
declare module 'openai';
declare module 'vite';
declare module 'multer';
declare module '@babel/standalone';
