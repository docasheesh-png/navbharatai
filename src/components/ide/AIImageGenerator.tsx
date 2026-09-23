import { draftAfterFailedSend } from '../../lib/draftAfterSend';
import { useState, useEffect, useRef } from 'react';
import { ModeButton } from '../chat/ModeButton';
import { ComposerShell, COMPOSER_ICON_CLASS, COMPOSER_SEND_CLASS, COMPOSER_TEXTAREA_CLASS } from '../chat/ComposerShell';
import { usePagedList } from '../../hooks/usePagedList';
import { LoadMore } from '../../components/common/LoadMore';
import { Send, Wand2, Sparkles, Download, Copy, Trash2, Check, Type, Image as ImageIcon, ImagePlus, ChevronDown, ChevronUp, Move } from 'lucide-react';
import { ImageOptionSelect, type ImageOption } from './ImageOptionSelect';
import { CustomSizeFields } from './CustomSizeFields';
import { ImageResizeEditor } from './ImageResizeEditor';
import { ReferenceImagePicker, type ReferencePicture } from './ReferenceImagePicker';
import { CUSTOM_SIZE_ID, DEFAULT_CUSTOM_SIZE, describeSize, resolveCustomSize } from '../../lib/imageSize';
import { Capacitor } from '@capacitor/core';
import { TirangaLoader } from '../ui/TirangaLoader';
import { dataUrlToBlob, dataUrlToBase64, imageFilename } from '../../lib/imageExport';
import { imageHistoryStore, pruneHistory, type ImageHistoryItem } from '../../lib/imageHistoryStore';
import { auth } from '../../lib/firebase';
import { ImageStudioPro } from './ImageStudioPro';
import { fetchImageFromUser, relayImage, type ClientFetchTicket } from '../../lib/clientImageFetch';
import { imageWaitMessage } from '../../lib/imageDelivery';
import { walletEmptyRefusalMessage } from '../../lib/walletEmptyRefusal';
import { AddCreditNotice } from '../common/AddCreditNotice';
import { fetchImageProAvailable, IMAGE_PRO_UNAVAILABLE_NOTE, type ImageProAvailability } from '../../lib/imageProAvailability';
import { TextOverlayEditor } from './TextOverlayEditor';
import { extractImageText, layersFromExtracted } from '../../lib/imageTextFromPrompt';
import { IMAGE_PROMPT_MAX, imagePromptLimit, imagePromptLimitNote } from '../../lib/imagePromptLimit';

type GeneratedImage = ImageHistoryItem;

interface Props {
  onImageGenerated?: (imageUrl: string, prompt: string) => void;
  /** Open the ONE mode picker (admin 2026-09-21); undefined on a phone, where the bottom bar has it. */
  onOpenModePicker?: (() => void) | undefined;
  /** Opens chat history from the composer's left column. Absent ⇒ no History button (the phone's bottom bar has it). */
  onOpenHistory?: (() => void) | undefined;
}

const STYLES = [
  // PHOTO IS FIRST, and that placement is the point (admin 2026-08-16: "realistic image banane ke liye
  // jo kuch ho sake karo"). Realism was previously UNREACHABLE — none of the six chips asked for a
  // photograph, so a user wanting one picked "3D" and got the isometric render it promises. First
  // position because it is what most people want most of the time.
  { id: 'photo', label: 'Realistic', desc: 'Real photo look', emoji: '📷' },
  // CINEMATIC sits second because it is the other half of the same ask (admin 2026-09-21: "kya yeh
  // aur behatar realistic, CINEMATIC nahi ban sakti?"). It is not "Realistic but stronger" — a film
  // still is deliberately LIT and graded where a photograph is observed, and the server's
  // STYLE_DIRECTION keeps them as two different briefs for exactly that reason.
  { id: 'cinematic', label: 'Cinematic', desc: 'Film still look', emoji: '🎬' },
  { id: 'minimal', label: 'Minimal', desc: 'Clean & simple', emoji: '⬜' },
  { id: 'vibrant', label: 'Vibrant', desc: 'Bold colors', emoji: '🌈' },
  { id: 'dark', label: 'Dark', desc: 'Dark aesthetic', emoji: '🌑' },
  { id: 'gradient', label: 'Gradient', desc: 'Smooth gradients', emoji: '🌅' },
  { id: 'flat', label: 'Flat', desc: 'Flat design', emoji: '📐' },
  { id: '3d', label: '3D', desc: 'Three dimensional', emoji: '🎯' },
];

// ⚠️ THESE MUST MATCH IMAGE_SIZE_PIXELS ON THE SERVER — a shared test asserts it. They did not
// (2026-08-16): the picker advertised 512×512 while the server generated 1024, and "App Icon 192×192"
// while it generated 512. Every number a user read here was wrong, which is its own small dishonesty
// and made the real fix — raising the resolution — impossible to even see.
const SIZES = [
  { id: 'square', label: 'Square', w: 1024, h: 1024, desc: '1024×1024' },
  { id: 'wide', label: 'Wide / OG', w: 1280, h: 720, desc: '1280×720' },
  { id: 'portrait', label: 'Portrait', w: 864, h: 1152, desc: '864×1152' },
  { id: 'icon', label: 'App Icon', w: 1024, h: 1024, desc: '1024×1024' },
  // The user's own width and height. Its `w`/`h` here are only the placeholder the picker shows
  // before anything is typed — the real pair lives in state and is sent as its own two fields,
  // because a size the SERVER has never heard of cannot be carried by an id alone.
  { id: CUSTOM_SIZE_ID, label: 'Custom', w: DEFAULT_CUSTOM_SIZE.w, h: DEFAULT_CUSTOM_SIZE.h, desc: 'Your own width and height' },
];

// Image types — a compulsory selector (exactly one is always active). The chosen type is
// combined into the real generation request, so it genuinely shapes the output.
const IMAGE_TYPES = [
  // 🔴 "Photograph" IS FIRST, AND THEREFORE THE DEFAULT, SINCE 2026-09-21 — the admin's report was
  // "cartoon jaisi image banti hai abhi", and this list is why. The type chip is COMPULSORY: every
  // request is forced into one of these art briefs, there was no neutral entry, and the default was
  // "Modern app logo" — whose server-side direction reads, word for word, "flat vector style … no
  // photorealism". So somebody who typed "a man drinking chai in a Delhi street" was commanding a
  // flat vector cartoon without ever choosing one. Nothing was wrong with the engine; our own prompt
  // asked for the cartoon.
  //
  // ⚠️ THE LABEL IS DELIBERATELY "Photograph" AND NOT "Photo / Scene": `PURPOSE_PATTERNS` matches
  // the bare word "scene" as an ILLUSTRATION brief, so that label would have quietly re-created the
  // same bug one word further along. A test pins that this label resolves to no purpose at all.
  'Photograph',
  'Modern app logo',
  'Website banner',
  'App icon',
  'UI screenshot',
  'Illustration',
  'Avatar',
  'Background',
  'Thumbnail',
];

/**
 * The colour hint is now a SELECTED value, not a button that appends words to the prompt.
 *
 * 🔴 WHY THAT IS A FIX AND NOT JUST A RESKIN. The old dots did `setPrompt(p => p + ' in indigo
 * tones')` on every press — so two presses wrote the phrase twice, and a user who changed their mind
 * had to find and delete their own text. A selector holds ONE answer and folds it in at send time,
 * which is also what the other three groups have always done. `none` is a real option, and the
 * default, so the prompt is untouched unless the user actually asks for a colour.
 *
 * ⚠️ The two raw hexes are picture colours — the colour the USER'S image will lean toward, not a
 * surface of ours that a theme repaints. Same exemption `textOverlay.ts` records for its defaults.
 */
const COLOR_HINTS: ImageOption[] = [
  { id: 'none', label: 'No preference', desc: 'Let the engine choose' },
  { id: 'indigo', label: 'Indigo', swatch: 'var(--brand-accent-strong)' },
  { id: 'emerald', label: 'Emerald', swatch: '#10b981' },
  { id: 'amber', label: 'Amber', swatch: 'var(--brand-warn-text)' },
  { id: 'red', label: 'Red', swatch: 'var(--brand-danger-text)' },
  { id: 'blue', label: 'Blue', swatch: 'var(--brand-info-text)' },
  { id: 'purple', label: 'Purple', swatch: '#8b5cf6' },
];

/**
 * The type list as options. Its `id` IS the label, deliberately: the selected type travels to the
 * server as `type` and is stored on every history row, so inventing a separate key here would mean
 * two vocabularies for one thing and a migration for rows already saved on people's devices.
 */
const IMAGE_TYPE_OPTIONS: ImageOption[] = IMAGE_TYPES.map((t) => ({ id: t, label: t }));

/**
 * Three openers for an empty thread. Not "prompt engineering" tips — real, ordinary Indian small-
 * business requests, because the commonest reason a first-time user writes nothing is not knowing
 * what kind of thing to ask for.
 */
const EXAMPLES = ['Tea shop banner', 'Clinic logo', 'Festival poster'];

/** A group's chosen option, by id — for the one-line summary printed on each sent request. */
/** The preset id whose pixels these are, or the custom id — so a resized picture's row reads right. */
function sizeIdFor(px: { w: number; h: number }): string | undefined {
  const hit = SIZES.find((o) => o.id !== CUSTOM_SIZE_ID && o.w === px.w && o.h === px.h);
  return hit ? hit.id : CUSTOM_SIZE_ID;
}

function labelOf(options: ImageOption[], id: string): string {
  return (options.find((o) => o.id === id) || options[0])?.label ?? '';
}

/**
 * 🔴 EVERY OPEN STARTS ON FREE — the tier is NOT remembered (admin-mandated 2026-09-22).
 *
 * Admin, verbatim: *"jab koi user navbharatai free me mode badal kar image genrator ai me swich
 * kare, to default free mode open hona chahiye. abhi paid mode open ho raha hai."*
 *
 * ⚠️ THIS REVERSES A DOCUMENTED DECISION, so the old reasoning is kept here rather than deleted.
 * It read: *"Persisted, because the toggle is a PREFERENCE — the admin's words were 'user uske
 * kabhi bhi free aur paid me convert kar sake', and a preference that resets on every panel open is
 * not one."* That was a fair reading, and it produced exactly the outcome reported: a user who
 * tried Pro once landed on the paid tier on every visit afterwards, having chosen it only on the
 * first. The half of the older instruction that still binds is "kabhi bhi convert kar sake" — and
 * it is untouched, because the toggle still switches instantly, for as long as the panel is open.
 *
 * 🔑 AND MONEY POINTS THE SAME WAY, which is what makes this the safe direction rather than merely
 * the requested one: a Pro image costs real rupees per press, so a REMEMBERED Pro is a charge the
 * user did not decide on this visit. Free is the only default that cannot spend somebody's balance
 * by being forgotten about. A remembered FREE would be harmless — but a rule of "remember only the
 * cheap one" is a rule nobody can predict, so the tier is simply not stored at all.
 *
 * ⚠️ NOTHING IS LEFT WRITING TO STORAGE. The `nbai.imagegen.tier` key and its read/write are gone
 * rather than kept "in case": a value nothing reads is a value the next reader will trust.
 */
/**
 * Whether the four selectors are shown or folded (admin 2026-09-21: "in charo ko bhi hide/expand ka
 * button do"). Remembered per device: somebody who folds them wants them folded next time too. The
 * settings themselves are untouched by folding — a folded row still SAYS what is in force, so a
 * user can never be surprised by a setting they cannot see.
 */
const OPTIONS_KEY = 'nbai.imagegen.options';
function readOptionsOpen(): boolean {
  try {
    return localStorage.getItem(OPTIONS_KEY) !== 'closed';
  } catch {
    return true;
  }
}

/**
 * What one Pro image costs, in ₹ — shown on the toggle so the switch names its own price.
 *
 * ⚠️ A COPY of the server's `IMAGE_PRO_PRICE_INR`, which is the authority; this file runs in the
 * browser and must not import server code. `tests/theProPriceIsOneNumber.test.ts` fails CI if they
 * ever disagree. It used to be the bare string 'Pro ₹2', which is how a price gets changed in two
 * places out of three.
 */
const PRO_PRICE_INR = 1;
export function AIImageGenerator({ onImageGenerated, onOpenModePicker, onOpenHistory }: Props) {
  // What the user PRESSED this visit, and what is actually shown, are two different things — see
  // `effectiveTier` below. Keeping them separate is what lets a dead paid tier be hidden WITHOUT
  // discarding a press the user really made: the moment Pro is switched on, their choice takes
  // effect by itself. (It used to survive the panel closing; see the block above for why it no
  // longer does — the two states are still separate, over a shorter life.)
  const [chosenTier, setChosenTier] = useState<'free' | 'pro'>('free');
  const [optionsOpen, setOptionsOpen] = useState<boolean>(readOptionsOpen);
  useEffect(() => {
    try { localStorage.setItem(OPTIONS_KEY, optionsOpen ? 'open' : 'closed'); } catch { /* a private window; the fold simply is not remembered */ }
  }, [optionsOpen]);
  /** Filled by the picker below the selectors; pressed by the attach button inside the input pill. */
  const attachRef = useRef<(() => void) | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  /** The words the star replaced, so one tap puts them back. Cleared on the next send or edit. */
  const [enhanceUndo, setEnhanceUndo] = useState<string | null>(null);
  const [proAvailable, setProAvailable] = useState<ImageProAvailability>(null);
  const [prompt, setPrompt] = useState('');
  const [imageType, setImageType] = useState(IMAGE_TYPES[0]); // compulsory — always one selected
  // Realistic by default, for the same reason "Photograph" leads the type list: an untouched screen
  // should make a real picture of what the user described, not a flat graphic they never asked for.
  // Minimal is one tap away and unchanged for anyone who wants it.
  const [style, setStyle] = useState('photo');
  const [size, setSize] = useState('square');
  const [colorHint, setColorHint] = useState('none');
  // The user's own picture, when they are CHANGING one instead of inventing one. Its presence is
  // what makes this request an edit — the same derivation the paid tier makes, so nobody has to
  // set a mode control to match what they attached.
  const [reference, setReference] = useState<ReferencePicture | null>(null);
  const [customW, setCustomW] = useState(DEFAULT_CUSTOM_SIZE.w);
  const [customH, setCustomH] = useState(DEFAULT_CUSTOM_SIZE.h);
  const [isLoading, setIsLoading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  // AN EMPTY BALANCE IS NOT A FAILURE (admin 2026-09-22: "this is paid service!!"). It used to land
  // in `errorMsg` as a red line next to a **Try again** button — and retrying an empty wallet cannot
  // work, so the only control offered was the one that could not help. Held separately so it renders
  // as what it is: a price, and the one action that clears it.
  const [balanceBlock, setBalanceBlock] = useState('');
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const pagedHistory = usePagedList(history);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [craftNotes, setCraftNotes] = useState<string[]>([]);
  // The countdown shown while the browser waits out the provider's rate limit. Blank the rest of
  // the time. A visible wait is the difference between "busy" and "broken" — the blank-screen
  // failure this repo already root-caused once on the chat path.
  const [waitNote, setWaitNote] = useState('');
  const [actionNote, setActionNote] = useState(''); // honest fallback message for copy/download
  /**
   * The request currently in flight, shown as the user's own message the instant they press send.
   * Without it the thread stays empty while the engine works and the press looks like it did nothing
   * — the blank-screen failure this repo already root-caused once on the chat path.
   */
  const [pending, setPending] = useState<{ prompt: string; summary: string } | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // REAL generation (admin autopsy 2026-07-20): images come from NavBharatAI's own server route
  // (/api/image/generate) on our configured image engine — the old code hot-linked a third-party
  // free image site from the browser (no server side at all; unreliable and outside our control).
  // History is PERSISTED in IndexedDB (admin 2026-07-24: "history save honi chahiye") — a generated
  // image is a multi-MB data URL that overflows localStorage, so IndexedDB holds up to 50 recents that
  // survive reload / tab close / app restart (per-device). Loaded on mount below.
  // The compulsory image type is always folded into what actually gets generated, so a selected
  // type shapes the output even when the free-text prompt is empty (type alone is a valid request).

  // Load the saved history once, on mount, so the user's past images are there after a reload.
  useEffect(() => {
    let alive = true;
    imageHistoryStore.getAll().then((items) => { if (alive) setHistory(items); }).catch(() => { /* store unavailable → empty */ });
    return () => { alive = false; };
  }, []);

  /** What each sent request says it was, in the user's own terms — never a model or vendor name. */
  const requestSummary = () => (reference
    // An edit's summary must not read like a brief for a new picture: the type, the style and the
    // colour hint were not applied to it, and printing them would describe work that never happened.
    ? ['Changing your picture', labelOf(SIZES, size)].filter(Boolean).join(' \u00b7 ')
    : [
      imageType,
      labelOf(STYLES, style),
      labelOf(SIZES, size),
      colorHint === 'none' ? '' : labelOf(COLOR_HINTS, colorHint),
    ].filter(Boolean).join(' \u00b7 '));

  /**
   * The words the engine receives.
   *
   * 🔴 AN EDIT SENDS THE USER'S WORDS AND NOTHING ELSE. For a NEW picture the image type is the
   * brief ("Modern app logo — coffee shop"), and that is right. Sent as the instruction for an EDIT
   * it says "turn this photograph into a logo" — which is the admin's "image badal jane ka dar"
   * written into the prompt by our own UI, before any model is even involved.
   */
  const buildEffectivePrompt = () => {
    if (reference) return prompt.trim();
    const tint = colorHint === 'none' ? '' : ` in ${labelOf(COLOR_HINTS, colorHint).toLowerCase()} tones`;
    return `${imageType}${prompt.trim() ? ` \u2014 ${prompt.trim()}` : ''}${tint}`;
  };

  // The server refuses a prompt over its limit, so a send that can only fail is not offered. The
  // limit is counted on what is SENT — the type and tint wrapped around the words included.
  const promptLimit = imagePromptLimit(prompt.trim(), buildEffectivePrompt());

  const handleGenerate = async () => {
    const effectivePrompt = buildEffectivePrompt();
    // A picture on its own IS a request ("re-render this"), so words are required only without one.
    if ((!effectivePrompt.trim() && !reference) || isLoading || promptLimit.over) return;
    // Captured ONCE, because the box is emptied on the next line and everything below that still
    // needs the words — the history row, the bubble, and the restore on failure.
    const typed = prompt.trim();
    setImageError(false);
    setBalanceBlock('');
    setErrorMsg('');
    setCraftNotes([]);
    // The user's message lands in the thread BEFORE the request goes out, so the press is visibly
    // answered even while nothing has come back yet.
    setPending({ prompt: typed, summary: requestSummary() });
    // THE BOX EMPTIES AT SEND, like every other box in this app (admin 2026-09-22: the brief sat in
    // the input for a whole 52-second retry countdown after the bubble had already appeared). A
    // failure below puts the words back — see `draftAfterFailedSend` for why only into an empty box.
    setPrompt('');
    setIsLoading(true);
    try {
      // Send the Firebase auth token — /api/image/generate requires a real account (per-image billing),
      // so WITHOUT this header the server saw an anonymous caller and asked the (already logged-in) user
      // to sign in. Root-caused 2026-07-31: the fetch previously sent no Authorization header.
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(await authHeaders()) };
      const res = await fetch('/api/image/generate', {
        method: 'POST',
        headers,
        // `type` goes as its OWN field (2026-08-14). It used to survive only as a prefix inside the
        // prompt string, so the server could not tell the selected type from the user's own words —
        // and that is precisely the signal the art-direction layer needs to know whether this must
        // read at 48px, leave room for a headline, or survive a circular crop.
        body: JSON.stringify({
          prompt: effectivePrompt,
          style,
          size,
          type: imageType,
          // Sent ONLY for a custom size, and already through the server's own clamp — so the number
          // in the request is the number the picker printed, and the server cannot quietly make
          // something else. For a preset these are absent and nothing downstream changes.
          ...(size === CUSTOM_SIZE_ID ? resolveCustomSize(customW, customH) : {}),
          // Present ONLY when the user attached their own picture — and its presence is what turns
          // this into an edit on the server, which skips the art-direction layer and the free
          // provider (neither of which can serve a picture that exists only inside this request).
          ...(reference ? { initImage: reference.dataUrl } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      // Checked BEFORE the generic throw: this is a bill, not a breakage, and the difference decides
      // which control the user is given. Switching on the server's `wallet_empty` code rather than on
      // its wording — the sentence is for the person and will be reworded, the code will not.
      const noCredit = walletEmptyRefusalMessage(res.status, data);
      if (noCredit) {
        setBalanceBlock(noCredit);
        setPrompt((cur) => draftAfterFailedSend(cur, typed)); // they will send it again after topping up
        return;
      }
      if (!res.ok || !data) {
        throw new Error((data && typeof data.error === 'string' && data.error)
          || 'Image generation failed — please try again.');
      }

      // ── THE BROWSER FETCHES IT, FROM THE USER'S OWN CONNECTION ────────────────────────────────
      // A free picture now comes back as a signed link rather than as bytes (admin 2026-09-21:
      // "free wale me user ki ip"). The provider's limit is one request every 15 seconds PER
      // ADDRESS, and our server is one address — so this is the only way a free tier survives real
      // numbers without a key. Everything before this point is unchanged: the prompt was triaged,
      // crafted and bounded on our server seconds ago.
      let imageUrl: string;
      let ticket: ClientFetchTicket | null = null;
      if (data.mode === 'client-fetch' && typeof data.url === 'string') {
        ticket = { url: data.url, ticket: String(data.ticket || ''), exp: Number(data.exp) };
        const got = await fetchImageFromUser(ticket, {
          onWait: (msLeft) => setWaitNote(imageWaitMessage(msLeft)),
        });
        setWaitNote('');
        if (got.error) throw new Error(got.error);
        if (got.dataUrl) {
          imageUrl = got.dataUrl;
          ticket = null; // the bytes are here; nothing will ever need the relay for this one
        } else {
          // This browser is not allowed to read another site's pixels. The picture still arrives
          // from the USER's connection — it is simply shown from the link — and the bytes are
          // fetched through our relay the moment a button actually needs them.
          imageUrl = ticket.url;
        }
      } else if (typeof data.image === 'string') {
        imageUrl = data.image;
      } else {
        throw new Error((typeof data.error === 'string' && data.error)
          || 'Image generation failed — please try again.');
      }
      // Honest caveats from the server — a style chip that was overruled, or the warning that image
      // engines cannot spell. Shown, never swallowed: a user who knows their shop name may come out
      // garbled can shorten it, where a silent misspelling just wastes a generation.
      setCraftNotes(Array.isArray(data.notes) ? data.notes.filter((n: unknown) => typeof n === 'string') : []);
      const newItem: GeneratedImage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url: imageUrl,
        ...(ticket ? { ticket: ticket.ticket, exp: ticket.exp } : {}),
        prompt: typed,
        type: imageType,
        style,
        size,
        timestamp: Date.now(),
      };
      // Persist to IndexedDB so it survives reloads, then reflect it in the UI (newest-first, bounded).
      setHistory((h) => pruneHistory([newItem, ...h]));
      void imageHistoryStore.save(newItem).catch(() => { /* persistence is best-effort — never blocks generation */ });
      if (onImageGenerated) onImageGenerated(imageUrl, effectivePrompt);
    } catch (e) {
      // Honest failure — the real reason from the server, never a placeholder image. The words come
      // back, because retyping a brief you already wrote is the worst possible answer to "that did
      // not work" — unless a new brief is already being typed, which is never overwritten.
      setPrompt((cur) => draftAfterFailedSend(cur, typed));
      setImageError(true);
      setErrorMsg(e instanceof Error ? e.message : 'Image generation failed — please try again.');
    } finally {
      setIsLoading(false);
      setPending(null);
      setWaitNote('');
    }
  };

  /**
   * ⭐ — rewrite the brief into a peak-level prompt, on request (admin 2026-09-21: "usko peak level
   * promt banwana sikhao!"). It used to paste six style keywords in front of the words — a
   * shortened copy of direction the server already applies in full. Now one short call on the
   * free ladder rewrites the user's OWN words and puts the result in the box, where they can read
   * it, change it, and undo it. The server refuses a rewrite that lost a name or a number, so what
   * lands here never drops a fact the user typed.
   */
  const handleEnhance = async () => {
    const original = prompt.trim();
    if (!original || enhancing) return;
    setEnhancing(true);
    try {
      const res = await fetch('/api/image/enhance-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          prompt: original,
          type: imageType,
          style: labelOf(STYLES, style),
          // The id beside the label — the server's precedence rule reads the id, the model reads the label.
          styleId: style,
          colorHint: labelOf(COLOR_HINTS, colorHint),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        flashNote(typeof data.error === 'string' ? data.error : 'NavBharatAI could not improve the prompt just now — your words are kept.');
        return;
      }
      if (data.ok && typeof data.prompt === 'string') {
        setEnhanceUndo(original);
        setPrompt(data.prompt);
        flashNote('Prompt improved — read it, change anything, then send. Undo puts your words back.');
      } else {
        flashNote(typeof data.note === 'string' ? data.note : 'NavBharatAI could not improve the prompt just now — your words are kept.');
      }
    } catch {
      flashNote('NavBharatAI could not improve the prompt just now — your words are kept.');
    } finally {
      setEnhancing(false);
    }
  };

  // Resolve the generated image to a real Blob. It is almost always a data: URL (the server returns
  // `data:<mime>;base64,<...>`), but fall back to fetch for any http(s) URL so both cases work.
  const resolveBlob = async (url: string): Promise<Blob> => {
    if (url.startsWith('data:')) return dataUrlToBlob(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Could not fetch the image');
    return res.blob();
  };

  // The clipboard image API only accepts PNG in most browsers — convert anything else via a canvas.
  const toPngBlob = async (blob: Blob): Promise<Blob> => {
    if (blob.type === 'image/png') return blob;
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new window.Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('image decode failed'));
        el.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 512;
      canvas.height = img.naturalHeight || 512;
      const ctx = canvas.getContext('2d');
      if (!ctx) return blob;
      ctx.drawImage(img, 0, 0);
      return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b || blob), 'image/png'));
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  // Which image the text editor is open on — an id, not a boolean, because this surface now shows a
  // whole thread and "Add text" has to mean the one whose button was pressed. The same shape the paid
  // studio already uses, so the two screens behave identically. Opened on demand, never mounted with
  // the panel: it loads the picture into a full-resolution canvas, which is real work to do for a
  // user who never presses the button.
  const [textOn, setTextOn] = useState<string | null>(null);
  /** The image whose Resize/Crop sheet is open — the same shape as `textOn`. */
  const [resizeOn, setResizeOn] = useState<string | null>(null);

  const flashNote = (msg: string) => {
    setActionNote(msg);
    setTimeout(() => setActionNote(''), 3500);
  };

  /** The Firebase bearer, for the routes that need a real account. Optional by design. */
  const authHeaders = async (): Promise<Record<string, string>> => {
    try {
      const tok = await auth.currentUser?.getIdToken();
      return tok ? { Authorization: `Bearer ${tok}` } : {};
    } catch {
      return {};
    }
  };

  /**
   * Guarantee we hold the picture's real BYTES before anything that needs them.
   *
   * 🔑 THIS IS THE ONE PLACE THE FOUR FEATURES ARE KEPT ALIVE (admin 2026-09-21: "yeh sab user ke ip
   * par kaam kar jaye, kisi bhi tarah"). "Add text", "Crop", "Copy" and "Download" all need real
   * pixels, and a browser may not read another site's pixels unless that site allows it. When it
   * does — the ordinary case — the bytes were already taken from the USER's connection at generation
   * time and this returns immediately. When it does not, our relay fetches them ONCE, on the press,
   * and the result is written back into history so the second press costs nothing.
   *
   * ⚠️ One function, every caller. Four call sites each doing their own version of this is exactly
   * how three of them would end up subtly different and one of them broken.
   */
  const ensureLocalImage = async (id: string): Promise<string | null> => {
    const item = history.find((h) => h.id === id);
    if (!item) return null;
    if (item.url.startsWith('data:')) return item.url;
    if (!item.ticket || !item.exp) {
      flashNote('This picture could not be opened for editing. Please make it again.');
      return null;
    }
    setActionNote('Getting the picture ready…');
    const got = await relayImage({ url: item.url, ticket: item.ticket, exp: item.exp }, await authHeaders());
    setActionNote('');
    if (!got.dataUrl) {
      flashNote(got.error || 'That picture could not be downloaded right now — please try again.');
      return null;
    }
    // Written back so the next press is instant, and so the saved history holds the real picture.
    const updated: GeneratedImage = { ...item, url: got.dataUrl, ticket: undefined, exp: undefined };
    setHistory((h) => h.map((x) => (x.id === id ? updated : x)));
    void imageHistoryStore.save(updated).catch(() => { /* persistence is best-effort */ });
    return got.dataUrl;
  };

  // COPY THE ACTUAL IMAGE (not the URL). Puts a real PNG on the clipboard so it pastes as a picture
  // into any app. Falls back to copying the link only if the browser can't do image clipboard.
  const handleCopyImage = async (id: string, generatedUrl: string) => {
    if (!generatedUrl) return;
    setActionNote('');
    try {
      const hasClipboardImage = typeof navigator !== 'undefined' && !!navigator.clipboard
        && typeof (window as unknown as { ClipboardItem?: unknown }).ClipboardItem !== 'undefined';
      if (!hasClipboardImage) throw new Error('no image clipboard');
      // Pass a Promise<Blob> into ClipboardItem (not an already-awaited Blob): Safari/iOS WebView keeps
      // the user-gesture alive across the async decode this way, so image copy works there too.
      const pngPromise = (async () => toPngBlob(await resolveBlob(generatedUrl)))();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })]);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000);
    } catch {
      // Honest fallback — tell the user we copied the link (not the image) so they know what they got.
      try { await navigator.clipboard.writeText(generatedUrl); } catch { /* clipboard fully blocked */ }
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000);
      flashNote('This device can’t copy the image itself — the image link was copied instead. Use Download to save the picture.');
    }
  };

  // Raw base64 for a native file write: prefer the data URL's own payload, else read the Blob.
  const toBase64 = async (url: string, blob: Blob): Promise<string> => {
    if (url.startsWith('data:')) {
      try { return dataUrlToBase64(url); } catch { /* fall through to FileReader */ }
    }
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const s = String(reader.result || '');
        resolve(s.slice(s.indexOf(',') + 1));
      };
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(blob);
    });
  };

  // ONE-TAP Save to Photos on the native app: write a temp file (Filesystem), then hand its file URI to
  // the media plugin (savePhoto → the device Photo gallery). Plugins are dynamically imported so the web
  // bundle never loads native code. Throws on any failure so the caller falls back to the share sheet.
  const saveToPhotosNative = async (base64: string, filename: string): Promise<void> => {
    const [{ Filesystem, Directory }, { Media }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor-community/media'),
    ]);
    const written = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    try {
      await Media.savePhoto({ path: written.uri });
    } finally {
      try { await Filesystem.deleteFile({ path: filename, directory: Directory.Cache }); } catch { /* best-effort cleanup */ }
    }
  };

  // DOWNLOAD / SAVE the image. Native: ONE-TAP Save to Photos (media plugin) → OS share sheet fallback.
  // Web: a blob-URL download (far more reliable than a data: href, which just opens a tab).
  const handleDownload = async (generatedUrl: string, forPrompt: string) => {
    if (!generatedUrl) return;
    setActionNote('');
    try {
      const blob = await resolveBlob(generatedUrl);
      const filename = imageFilename(forPrompt, blob.type);

      if (Capacitor.isNativePlatform()) {
        // 1) Primary: save straight to the Photos gallery, one tap.
        try {
          const base64 = await toBase64(generatedUrl, blob);
          await saveToPhotosNative(base64, filename);
          flashNote('Saved to your Photos ✓');
          return;
        } catch { /* permission denied / plugin error → fall through to the share sheet */ }
        // 2) Fallback: OS share sheet (Save Image / Save to Files).
        try {
          const file = new File([blob], filename, { type: blob.type });
          const nav = navigator as Navigator & { canShare?: (d?: unknown) => boolean };
          if (nav.canShare && nav.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: filename });
            return;
          }
        } catch (e) {
          if ((e as { name?: string })?.name === 'AbortError') return; // user cancelled the share sheet
          // else fall through to the blob-URL download
        }
      }

      // Web (and native final fallback): trigger a real file download from a blob URL.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch {
      flashNote('Could not save the image automatically — long-press the image to save it.');
    }
  };

  const handleClearHistory = () => {
    setHistory([]);
    void imageHistoryStore.clear().catch(() => { /* best-effort — the UI is already cleared */ });
  };

  /** Remove ONE image. The store already had `remove(id)`; the old grid never offered it. */
  const handleDeleteOne = (id: string) => {
    setHistory((h) => h.filter((x) => x.id !== id));
    void imageHistoryStore.remove(id).catch(() => { /* best-effort — the row is already gone here */ });
  };

  /** Put a past request's settings back in the composer, so "one more like that" costs no retyping. */
  const reuse = (item: GeneratedImage) => {
    setPrompt(item.prompt);
    setImageType(item.type || IMAGE_TYPES[0]);
    setStyle(item.style);
    setSize(item.size);
    taRef.current?.focus();
  };

  const relativeTime = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  // Ask the server whether the paid tier can serve, BEFORE the user writes anything. While the
  // answer is unknown (`null`) the panel behaves exactly as it did before this existed.
  useEffect(() => {
    let live = true;
    void fetchImageProAvailable().then((ok) => { if (live) setProAvailable(ok); });
    return () => { live = false; };
  }, []);

  // The newest image sits at the BOTTOM, closest to the input, so it appears where the eye already
  // is rather than at the far end of a scroll. Same rule as the paid studio.
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [history.length, isLoading]);

  // The box grows with the words instead of scrolling inside a fixed height — a two-line brief
  // should be readable while it is being written.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 128)}px`;
  }, [prompt]);

  // 🔒 A tier that CANNOT serve is never the one on screen. Only an explicit `false` forces Free, so
  // an unknown or unreachable answer leaves the user exactly where they chose to be.
  const effectiveTier: 'free' | 'pro' = proAvailable === false ? 'free' : chosenTier;
  const proOff = proAvailable === false;

  const selectedSize = SIZES.find(s => s.id === size) || SIZES[0];
  /** The pixels this request will really be made at — the custom pair, or the preset's own numbers. */
  const willMakeAt = size === CUSTOM_SIZE_ID ? resolveCustomSize(customW, customH) : { w: selectedSize.w, h: selectedSize.h };

  /**
   * Oldest at the top, newest against the input — chat order.
   *
   * The store keeps history NEWEST-first, so `pagedHistory.visible` is the N most recent; reversing
   * it means "Load more" reveals OLDER images upward, which is how every conversation in this app
   * already scrolls. Paging is kept exactly as it was: a generated image is a multi-megabyte data
   * URL, and fifty of them in the DOM at once is the thing `usePagedList` exists to prevent.
   */
  const thread = [...pagedHistory.visible].reverse();

  return (
    <div className={`h-full flex flex-col text-ink overflow-hidden ${effectiveTier === 'pro' ? 'bg-surface' : 'bg-surface'}`}>
      {/* Header. In Pro it collapses to a single slim bar carrying only the toggle — the studio below
          introduces itself, and a dense title block would undo the restraint the whole surface is for.
          The toggle itself is never hidden: a user must always be one press from the free tier, which
          is exactly what Pro's own error messages tell them to do. */}
      <div className={`flex items-center gap-3 border-b border-line ${
        effectiveTier === 'pro' ? 'px-4 sm:px-6 py-2.5 bg-transparent' : 'px-6 py-4 bg-card'
      }`}>
        {effectiveTier === 'free' && (
          <>
            <div className="w-10 h-10 bg-violet-600/20 rounded-xl flex items-center justify-center shrink-0">
              <Wand2 className="w-5 h-5 text-accent-text" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-ink text-base truncate">AI Image Generator</h2>
              <p className="text-xs text-faint truncate">Write a prompt to generate images — logos, banners, icons</p>
            </div>
          </>
        )}
        {/* The static "Free" badge was a LABEL; this is a CONTROL (admin 2026-09-18: "free ke jagah
            free-paid ke toggle bana do … user uske kabhi bhi free aur paid me convert kar sake").
            Both states are always reachable — switching back to Free is one press, and it is the
            press the paid tier's own error messages point at when Pro cannot serve. */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline text-[10px] bg-violet-500/20 text-accent-text px-2 py-1 rounded-full border border-violet-500/30">NavBharatAI</span>
          <div role="tablist" aria-label="Image quality tier" className="flex items-center bg-well border border-line rounded-full p-0.5">
            {(['free', 'pro'] as const).map((t) => {
              // The paid chip stops being a control when the paid tier cannot serve. It is still
              // SHOWN — hiding it would leave a user who had chosen Pro unable to see what happened
              // to their choice — but it says so, and pressing it can no longer cost them a prompt.
              const dead = t === 'pro' && proOff;
              return (
                <button
                  key={t}
                  role="tab"
                  aria-selected={effectiveTier === t}
                  aria-disabled={dead}
                  disabled={dead}
                  title={dead ? IMAGE_PRO_UNAVAILABLE_NOTE : undefined}
                  onClick={() => { if (!dead) setChosenTier(t); }}
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full transition-colors ${
                    dead
                      ? 'text-faint cursor-not-allowed'
                      : effectiveTier === t
                        ? (t === 'pro' ? 'bg-amber-400 text-black' : 'bg-emerald-400 text-black')
                        : 'text-muted hover:text-body'
                  }`}
                >
                  {t === 'pro' ? `Pro ₹${PRO_PRICE_INR}` : 'Free'}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ⚠️ A `title` on the chip above is DESKTOP-ONLY — a finger never hovers, and a phone is where
          this was reported. So the fact is also stated in the layout, once, where the toggle is. */}
      {proOff && (
        <div className="px-4 sm:px-6 py-2 bg-amber-500/10 border-b border-line">
          <p className="text-xs text-body">{IMAGE_PRO_UNAVAILABLE_NOTE}</p>
        </div>
      )}

      {effectiveTier === 'pro' ? (
        <div className="flex-1 min-h-0">
          <ImageStudioPro onImageGenerated={onImageGenerated} onOpenModePicker={onOpenModePicker} onOpenHistory={onOpenHistory} />
        </div>
      ) : (
      <div className="flex-1 min-h-0 flex flex-col">
        {/* ── THE THREAD ──────────────────────────────────────────────────────────────────────
            Admin, 2026-09-21: "pure chat box ka ui bhi sabhi ai ke jaise banao. sabse niche input
            box. uske upar 4 selector."

            The old layout was two side-by-side columns — every option on the left, the result on the
            right — which on a phone stacked into one long form whose Generate button sat below about
            twenty-five controls. This is the shape every other AI surface here already has, and the
            one the paid studio has had since it shipped: what you made grows upward out of the box
            you typed in. `flex-1 min-h-0` on the thread and `shrink-0` on the dock are what pin the
            input; without the `min-h-0` a long thread pushes the dock off the bottom of the panel
            instead of scrolling inside itself. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-3">
          {thread.length === 0 && !isLoading && !imageError && !pending ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-4">
              <div className="w-14 h-14 rounded-2xl bg-card border border-line flex items-center justify-center">
                <ImageIcon className="w-6 h-6 text-accent-text" />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">No images yet</p>
                <p className="text-xs text-muted mt-1">Your images appear here, newest at the bottom.</p>
              </div>
              {/* ── WHAT THE FREE TIER IS FOR, said before the first send ────────────────────
                  Admin, 2026-09-21: *"free image generator me, ek watermark jaise chat box me hi
                  likh dekha, image only for your app … jisse log real cinematic image na ban pane
                  se nirash nahi honge"* — and, the same day: *"is line ko, niche nahi. upar likhna
                  hai. jahan 'no image yet' likh ke ata hai"*. So it lives HERE, in the empty state,
                  and not under the input on every send.

                  🔑 IT IS EXPECTATION, NOT AN APOLOGY. The free engine is genuinely good at flat,
                  graphic work — a logo, an icon, a banner, an illustration — and genuinely weaker
                  at photographic and cinematic scenes. A user who asks it for a film still and is
                  disappointed was not failed by the picture; they were failed by nobody telling
                  them which job this tool is for. Saying it once, where they start, turns a bad
                  result into an informed choice.

                  ⚠️ It never says "you cannot" and it never names a vendor. The Pro button is a REAL
                  control (the same tier state the toggle above uses), and it is hidden entirely
                  when Pro cannot serve — advice pointing at a door that does not open is worse
                  than none. */}
              <p className="text-[11px] text-faint leading-relaxed max-w-xs flex items-center justify-center gap-1.5 flex-wrap">
                <Wand2 className="w-2.5 h-2.5 shrink-0" />
                <span>Free images are made for your app’s artwork — logos, icons, banners, illustrations.</span>
                {!proOff && (
                  <>
                    <span>For photo-real or cinematic pictures,</span>
                    <button
                      type="button"
                      onClick={() => setChosenTier('pro')}
                      className="underline text-accent-text hover:text-ink transition-colors"
                    >
                      use Pro
                    </button>
                    <span>— this tier stays free.</span>
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {EXAMPLES.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => { setPrompt(e); taRef.current?.focus(); }}
                    className="text-[11px] text-body bg-card border border-line rounded-full px-3 py-1.5 hover:border-accent-text/40 transition-colors"
                  >
                    {e}
                  </button>
                ))}
              </div>
              <ul className="text-[11px] text-faint space-y-1 mt-2 max-w-xs text-left">
                <li>Be specific: "blue gradient tech logo", not just "logo".</li>
                <li>The four selectors below shape every image you send.</li>
                <li>Add a phone number or a rate list with "Add text" — typed, not drawn.</li>
              </ul>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-4">
              <LoadMore list={pagedHistory} label="images" />
              {history.length > 0 && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={handleClearHistory}
                    className="text-[10px] text-faint hover:text-danger flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> Clear all
                  </button>
                </div>
              )}

              {thread.map((item) => (
                <div key={item.id} className="space-y-2">
                  {/* The request, as the user made it. A real button, because tapping it puts those
                      same settings back in the composer — "one more like that" with no retyping. */}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => reuse(item)}
                      title="Use these settings again"
                      className="max-w-[85%] text-left rounded-2xl rounded-br-md bg-accent text-on-accent px-3 py-2"
                    >
                      <span className="block text-xs leading-relaxed">{item.prompt || item.type || 'Image'}</span>
                      <span className="block text-[10px] opacity-80 mt-1">
                        {[item.type, labelOf(STYLES, item.style), labelOf(SIZES, item.size)].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  </div>

                  {/* The answer. */}
                  <div className="rounded-2xl rounded-bl-md border border-line bg-card overflow-hidden">
                    <img
                      src={item.url}
                      alt={item.prompt || item.type || 'Generated image'}
                      loading="lazy"
                      className="w-full h-auto block"
                    />
                    <div className="flex items-center gap-1.5 p-2">
                      <button
                        type="button"
                        onClick={() => void ensureLocalImage(item.id).then((ok) => { if (ok) setTextOn(item.id); })}
                        className="flex-1 min-w-0 text-[11px] font-semibold text-on-accent bg-violet-600 hover:bg-violet-500 rounded-lg py-2 flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Type className="w-3 h-3" /> Add text
                      </button>
                      <button
                        type="button"
                        onClick={() => void ensureLocalImage(item.id).then((ok) => { if (ok) setResizeOn(item.id); })}
                        className="flex-1 min-w-0 text-[11px] font-semibold text-body bg-raised border border-line rounded-lg py-2 flex items-center justify-center gap-1.5"
                      >
                        <Move className="w-3 h-3" /> Resize
                      </button>
                      <button
                        type="button"
                        onClick={() => void ensureLocalImage(item.id).then((url) => { if (url) void handleCopyImage(item.id, url); })}
                        className="flex-1 min-w-0 text-[11px] font-semibold text-body bg-raised border border-line rounded-lg py-2 flex items-center justify-center gap-1.5"
                      >
                        {copiedId === item.id
                          ? <><Check className="w-3 h-3 text-success" /> Copied</>
                          : <><Copy className="w-3 h-3" /> Copy</>}
                      </button>
                      <button
                        type="button"
                        onClick={() => void ensureLocalImage(item.id).then((url) => { if (url) void handleDownload(url, item.prompt); })}
                        className="flex-1 min-w-0 text-[11px] font-semibold text-body bg-raised border border-line rounded-lg py-2 flex items-center justify-center gap-1.5"
                      >
                        <Download className="w-3 h-3" /> Save
                      </button>
                      <button
                        type="button"
                        aria-label="Delete this image"
                        onClick={() => handleDeleteOne(item.id)}
                        className="shrink-0 w-9 h-9 rounded-lg bg-raised border border-line text-muted hover:text-danger flex items-center justify-center transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-faint pl-1">{relativeTime(item.timestamp)}</p>
                </div>
              ))}

              {pending && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent text-on-accent px-3 py-2">
                    <span className="block text-xs leading-relaxed">{pending.prompt || imageType}</span>
                    <span className="block text-[10px] opacity-80 mt-1">{pending.summary}</span>
                  </div>
                </div>
              )}

              {isLoading && (
                <div className="flex items-center gap-3 rounded-2xl rounded-bl-md border border-line bg-card px-3 py-3 w-fit">
                  <TirangaLoader className="w-5 h-5" />
                  <span className="text-xs text-muted">
                    {waitNote
                      // The provider allows one picture every 15 seconds per connection, and on a
                      // shared mobile network several people can be behind one. Counting down is what
                      // makes that read as "busy" rather than "broken".
                      ? waitNote
                      : reference
                        ? 'Changing your picture — keeping everything you did not ask to change...'
                        : `Painting your image at ${describeSize(willMakeAt.w, willMakeAt.h)}...`}
                  </span>
                </div>
              )}

              {/* The wallet, not a fault. No "Try again" here on purpose: the next press would be
                  refused by the same gate, and offering it is what made a price look like a bug. */}
              {!isLoading && balanceBlock && (
                <AddCreditNotice
                  message={balanceBlock}
                  className="rounded-2xl rounded-bl-md border border-line bg-card px-3 py-3 space-y-2"
                />
              )}

              {!isLoading && imageError && !balanceBlock && (
                <div className="rounded-2xl rounded-bl-md border border-line bg-card px-3 py-3 space-y-2">
                  <p className="text-xs text-danger leading-relaxed">
                    {errorMsg || 'Image could not be generated. Retry or change the prompt.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleGenerate()}
                    className="text-[11px] font-semibold text-accent-text hover:underline"
                  >
                    Try again
                  </button>
                </div>
              )}

              {/* Art-direction notes from the server: a style chip overruled by the user's own
                  wording, or the standing warning that image engines cannot spell. They belong
                  beside the finished image, where the user can act on them — a spelling warning
                  after the fact is what saves the NEXT generation. */}
              {craftNotes.length > 0 && (
                <ul className="space-y-1">
                  {craftNotes.map((n, i) => (
                    <li key={i} className="text-[11px] text-info leading-relaxed flex gap-1.5">
                      <span aria-hidden="true">-</span><span>{n}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div ref={feedEndRef} />
            </div>
          )}
        </div>

        {/* ── THE DOCK: four selectors, then the input, and nothing else ─────────────────────── */}
        <div className="shrink-0 border-t border-line px-3 sm:px-4 pt-2.5 pb-3">
          <div className="max-w-2xl mx-auto space-y-2">
            {/* Honest fallback note (this device cannot copy a raw image, or a save needs a long-press). */}
            {actionNote && (
              <p className="text-[11px] text-warn leading-relaxed">{actionNote}</p>
            )}

            {/* ── THE FOUR SELECTORS, foldable (admin 2026-09-21: "hide/expand ka button do") ──
                Folded, ONE line still names every setting in force, so hiding the controls never
                hides what they will do to the next image. */}
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-faint truncate min-w-0">
                {optionsOpen
                  ? 'Options'
                  : [imageType, labelOf(STYLES, style), labelOf(SIZES, size), labelOf(COLOR_HINTS, colorHint)].filter(Boolean).join(' · ')}
              </p>
              <button
                type="button"
                onClick={() => setOptionsOpen((o) => !o)}
                aria-expanded={optionsOpen}
                aria-controls="nbai-image-options"
                className="shrink-0 text-[10px] text-muted hover:text-ink flex items-center gap-1 transition-colors"
              >
                {optionsOpen ? <>Hide <ChevronDown className="w-3 h-3" /></> : <>Options <ChevronUp className="w-3 h-3" /></>}
              </button>
            </div>
            {optionsOpen && (
            <div id="nbai-image-options" className="grid grid-cols-2 gap-2">
              <ImageOptionSelect
                label="Image type"
                heading="What are you making?"
                options={IMAGE_TYPE_OPTIONS}
                value={imageType}
                onChange={setImageType}
              />
              <ImageOptionSelect
                label="Style"
                heading="How should it look?"
                options={STYLES}
                value={style}
                onChange={setStyle}
              />
              <ImageOptionSelect
                label="Size / format"
                heading="What shape do you need?"
                options={SIZES}
                value={size}
                onChange={setSize}
              />
              <ImageOptionSelect
                label="Colour hint"
                heading="Lean toward a colour?"
                options={COLOR_HINTS}
                value={colorHint}
                onChange={setColorHint}
              />
            </div>
            )}

            {/* Only when it is chosen, and only while the options are open: four selectors plus two
                number fields on every build would be the crowded screen the dropdowns were
                introduced to clear. */}
            {optionsOpen && size === CUSTOM_SIZE_ID && (
              <CustomSizeFields
                width={customW}
                height={customH}
                onChange={(w, h) => { setCustomW(w); setCustomH(h); }}
                className="rounded-xl border border-line bg-card px-2.5 py-2"
              />
            )}

            {/* ── CHANGE MY OWN PICTURE ────────────────────────────────────────────────────
                Sits directly above the input because it changes what the input MEANS: with a
                picture attached the words are an instruction about that picture ("make the awning
                blue"), not a description of a new one. The placeholder below says so too. */}
            <ReferenceImagePicker
              value={reference}
              onChange={setReference}
              frame={willMakeAt}
              disabled={isLoading}
              openRef={attachRef}
            />

            {/* Outside the pill, to its left — same placement and same shared button as every other
                composer in the app (admin 2026-09-21). */}
            {/* THE FREE CHAT'S COMPOSER (admin 2026-09-23: "sabhi ai … navbharatai free ke jaisa karo").
                Mode outside on the left; attach, the star and Generate inside on the right, where the
                free chat keeps its controls. The look is the one shared shell — see ComposerShell. */}
            <ComposerShell
              onOpenHistory={onOpenHistory}
              onOpenMode={onOpenModePicker}
              controls={(
                <>
                  {/* ATTACH (admin 2026-09-21: inside the box). Opens the picker's chooser; the crop
                      rule stays there. */}
                  <button
                    type="button"
                    onClick={() => attachRef.current?.()}
                    disabled={isLoading}
                    aria-label="Attach your own picture to change"
                    title={reference ? 'Your picture is attached — tap the pencil above to adjust it' : 'Change my own picture'}
                    className={`${COMPOSER_ICON_CLASS} ${reference ? 'text-accent-text' : ''}`}
                  >
                    <ImagePlus className="w-4 h-4" />
                  </button>
                  {/* Enhance is DISABLED when the chosen style has no keywords to add, rather than
                      present and inert: "built but not really working" is the state this app does not
                      have. Realistic is exactly that case — it adds none. */}
                  <button
                    type="button"
                    onClick={() => void handleEnhance()}
                    disabled={enhancing || !!reference || prompt.trim().length < 3 || prompt.trim().length > IMAGE_PROMPT_MAX}
                    aria-label="Improve my prompt"
                    title={reference
                      ? 'The star writes a brief for a NEW picture — it would restyle the one you attached'
                      : prompt.trim().length < 3 ? 'Write a few words first' : 'Rewrite my words as a professional prompt'}
                    className={COMPOSER_ICON_CLASS}
                  >
                    {enhancing ? <TirangaLoader className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                  </button>
                </>
              )}
              send={(
                <>
                  <button
                    type="button"
                    onClick={() => void handleGenerate()}
                    disabled={isLoading || promptLimit.over}
                    aria-label="Generate image"
                    title={promptLimit.over ? 'Too long to send — please shorten it' : undefined}
                    className={COMPOSER_SEND_CLASS}
                  >
                    {isLoading ? <TirangaLoader className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                  </button>
                </>
              )}
            >
              <label htmlFor="nbai-image-prompt" className="sr-only">
                {reference ? 'Describe the change you want' : 'Describe your image'}
              </label>
              <textarea
                id="nbai-image-prompt"
                ref={taRef}
                rows={1}
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); if (enhanceUndo !== null) setEnhanceUndo(null); }}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter breaks the line — the convention every chat input in
                  // this app uses, and the reason the box grows rather than scrolls.
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleGenerate(); }
                }}
                placeholder={reference ? 'What should change? e.g. make the background blue' : 'Describe your image...'}
                className={COMPOSER_TEXTAREA_CLASS}
              />
            </ComposerShell>
            {promptLimit.near && (
              <p className={`text-[11px] text-right px-3 ${promptLimit.over ? 'text-danger' : 'text-faint'}`} aria-live="polite">
                {imagePromptLimitNote(promptLimit)}
              </p>
            )}

            {/* With a picture attached the words mean something different — say so where they are
                typed. The "what the free tier is for" line moved UP into the empty state (admin
                2026-09-21: "upar likhna hai, jahan 'no image yet' likh ke ata hai"). */}
            {enhanceUndo !== null && (
              <p className="text-[10px] text-faint text-center leading-relaxed flex items-center justify-center gap-1.5">
                <Sparkles className="w-2.5 h-2.5 shrink-0" />
                <span>Prompt improved.</span>
                <button
                  type="button"
                  onClick={() => { setPrompt(enhanceUndo); setEnhanceUndo(null); }}
                  className="underline text-accent-text hover:text-ink transition-colors"
                >
                  Undo
                </button>
              </p>
            )}
            {reference && (
              <p className="text-[10px] text-faint text-center leading-relaxed flex items-center justify-center gap-1.5">
                <Wand2 className="w-2.5 h-2.5 shrink-0" />
                <span>Only what you ask for changes — the rest of your picture is kept.</span>
              </p>
            )}
          </div>
        </div>
      </div>
      )}

      {/* The typed text replaces that image in the thread, so Copy and Save then mean the version
          WITH the text on it — which is what someone who just pressed Done expects. */}
      {resizeOn && (() => {
        const target = history.find((h) => h.id === resizeOn);
        if (!target) return null;
        return (
          <ImageResizeEditor
            image={target.url}
            initialSize={target.size || SIZES[0].id}
            initialCustom={target.width && target.height ? { w: target.width, h: target.height } : undefined}
            sizes={SIZES}
            onClose={() => setResizeOn(null)}
            onDone={(url, made) => {
              // Replace IN PLACE and remember the new size, so Add text and a later Resize open on
              // the picture as it now is, and Copy / Save mean this version.
              const updated = { ...target, url, size: sizeIdFor(made) ?? target.size, width: made.w, height: made.h };
              setHistory((h) => h.map((x) => (x.id === resizeOn ? updated : x)));
              void imageHistoryStore.save(updated).catch(() => { /* best-effort, as every save here is */ });
              setResizeOn(null);
              flashNote(`Resized to ${describeSize(made.w, made.h)} \u2713  Now press Save to keep it.`);
            }}
          />
        );
      })()}

      {textOn && (() => {
        const target = history.find((h) => h.id === textOn);
        if (!target) return null;
        // 🔴 READ FROM THE IMAGE'S OWN REQUEST, not from the composer. Until this screen became a
        // thread there was one image and one prompt, so "whatever is in the box" was the same
        // thing. It is not any more: the box is cleared on a successful send, and by the time a
        // user scrolls up to put a phone number on their FIRST image the box holds their third
        // request. Extracting from `target.prompt` keeps each image's text tied to the words that
        // asked for it.
        const found = extractImageText(target.prompt);
        return (
          <TextOverlayEditor
            imageUrl={target.url}
            initialLayers={layersFromExtracted(found, () => `p${Date.now()}${Math.random().toString(36).slice(2, 7)}`)}
            extracted={found}
            onClose={() => setTextOn(null)}
            onApply={(url) => {
              // Replace the image IN PLACE, and persist it. Appending a second copy would leave two
              // near-identical images in the thread and no way to tell which one carries the right
              // phone number.
              const updated = { ...target, url };
              setHistory((h) => h.map((x) => (x.id === textOn ? updated : x)));
              void imageHistoryStore.save(updated).catch(() => { /* best-effort, as every save here is */ });
              setTextOn(null);
              flashNote('Text added \u2713  Now press Save to keep it.');
            }}
          />
        );
      })()}
    </div>
  );
}
