// Golden scaffold: AI image generator (admin 2026-10-01: "hidden templates me sabse pahle 'AI image
// generator' … gst, todo uske baad dikhe").
//
// The picture engine is NOT written here. It is the `generate_image_ai` recipe's own browser module and
// React hook (src/server/lib/ImageAiGenerator.ts), so the template and every builder-written image app
// run one tested engine and cannot drift apart. This file holds only the screen.

import { generateImageAiIntegration } from '../../lib/ImageAiGenerator';

/** The engine files, exactly as the recipe writes them for a React app with no server. */
export function aiImageEngineFiles(): Record<string, string> {
  return generateImageAiIntegration({ server: false, react: true }).files;
}

export const aiImageAppTsx = `import { useState } from 'react';
import type { FormEvent } from 'react';
import ThemeToggle from './theme';
import { downloadImage, MAX_PROMPT_LENGTH } from './lib/imageAi';
import { useImageGenerator } from './lib/useImageGenerator';

interface Shape {
  id: string;
  label: string;
  width: number;
  height: number;
}

const SQUARE: Shape = { id: 'square', label: 'Square', width: 1024, height: 1024 };
const SHAPES: Shape[] = [
  SQUARE,
  { id: 'wide', label: 'Wide', width: 1344, height: 768 },
  { id: 'portrait', label: 'Portrait', width: 768, height: 1344 },
];

const IDEAS = [
  'A tiger resting under a banyan tree at golden hour',
  'A chai stall on a rainy Mumbai street, watercolour',
  'The Taj Mahal at sunrise in soft mist, photograph',
  'A friendly robot reading a book in a library, 3D render',
];

function App() {
  const [prompt, setPrompt] = useState('');
  const [shapeId, setShapeId] = useState(SQUARE.id);
  const { status, image, error, attempt, isGenerating, generate, retry, again, cancel } = useImageGenerator();
  const shape = SHAPES.find((s) => s.id === shapeId) ?? SQUARE;
  const ready = prompt.trim().length > 0 && !isGenerating;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    void generate({ prompt, width: shape.width, height: shape.height });
  };

  return (
    <div className="container" style={{ maxWidth: 560, paddingTop: 32, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>AI Image Generator</h1>
        <ThemeToggle />
      </div>

      <form className="card stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="image-prompt">Describe your picture</label>
          <textarea
            id="image-prompt"
            rows={3}
            maxLength={MAX_PROMPT_LENGTH}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="A tiger resting under a banyan tree at golden hour"
          />
        </div>
        <div className="nb-chips" aria-label="Ideas to try">
          {IDEAS.map((idea) => (
            <button type="button" key={idea} className="nb-chip" onClick={() => setPrompt(idea)}>
              {idea}
            </button>
          ))}
        </div>
        <div className="row">
          <span className="muted">Shape</span>
          {SHAPES.map((s) => (
            <button
              type="button"
              key={s.id}
              className={s.id === shapeId ? 'primary' : ''}
              aria-pressed={s.id === shapeId}
              onClick={() => setShapeId(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button type="submit" className="primary" disabled={!ready}>
          {isGenerating ? 'Generating...' : 'Generate'}
        </button>
      </form>

      {isGenerating && (
        <div className="card stack" role="status" aria-live="polite" style={{ alignItems: 'center', marginTop: 16 }}>
          <span className="nb-spinner" aria-hidden="true" />
          <p className="muted" style={{ margin: 0 }}>
            {attempt > 0
              ? 'The image service is busy, trying again (' + attempt + ')...'
              : 'Making your picture. This usually takes a few seconds...'}
          </p>
          <button type="button" onClick={cancel}>Cancel</button>
        </div>
      )}

      {error && !isGenerating && (
        <div className="alert alert-danger stack" role="alert" style={{ marginTop: 16 }}>
          <span>{error}</span>
          <button type="button" onClick={retry}>Try again</button>
        </div>
      )}

      {image && !isGenerating && (
        <div className="card stack nb-fade" style={{ marginTop: 16 }}>
          <img
            src={image.url}
            alt={image.prompt}
            width={image.width}
            height={image.height}
            style={{ width: '100%', height: 'auto', borderRadius: 12 }}
          />
          <div className="row">
            <button type="button" className="primary" onClick={() => downloadImage(image)}>Download</button>
            <button type="button" onClick={again}>Generate another</button>
          </div>
        </div>
      )}

      {status === 'idle' && !image && (
        <div className="nb-empty" style={{ marginTop: 16 }}>
          <div className="nb-empty-icon" aria-hidden="true">🎨</div>
          <div className="nb-empty-title">Your picture appears here</div>
          <div className="nb-empty-text">Describe anything, or tap an idea, then press Generate.</div>
        </div>
      )}
    </div>
  );
}

export default App;
`;
