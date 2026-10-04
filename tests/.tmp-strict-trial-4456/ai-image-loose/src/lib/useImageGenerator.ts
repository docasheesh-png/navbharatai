// React state for making pictures: status, the current picture, errors, retry and cancel.
import { useCallback, useEffect, useRef, useState } from 'react';
import { describeImageError, generateImage, releaseImage } from './imageAi';
import type { GeneratedImage, ImageRequest } from './imageAi';

export type ImageStatus = 'idle' | 'generating' | 'done' | 'error';

export function useImageGenerator() {
  const [status, setStatus] = useState<ImageStatus>('idle');
  const [image, setImage] = useState<GeneratedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 0 on the first try; 1, 2, ... while retrying after a busy or slow answer. */
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const current = useRef<GeneratedImage | null>(null);
  const last = useRef<ImageRequest | null>(null);

  useEffect(() => () => {
    controller.current?.abort();
    releaseImage(current.current);
  }, []);

  const generate = useCallback(async (request: ImageRequest) => {
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    last.current = request;
    setStatus('generating');
    setError(null);
    setAttempt(0);
    try {
      const made = await generateImage(request, { signal: ctl.signal, onRetry: (n) => setAttempt(n) });
      if (ctl.signal.aborted) {
        releaseImage(made);
        return;
      }
      releaseImage(current.current);
      current.current = made;
      setImage(made);
      setStatus('done');
    } catch (err) {
      if (ctl.signal.aborted) return;
      setError(describeImageError(err));
      setStatus('error');
    }
  }, []);

  /** Try the last description again. */
  const retry = useCallback(() => {
    if (last.current) void generate(last.current);
  }, [generate]);

  /** Same description, a new picture. */
  const again = useCallback(() => {
    if (!last.current) return;
    const next: ImageRequest = { prompt: last.current.prompt };
    if (last.current.width !== undefined) next.width = last.current.width;
    if (last.current.height !== undefined) next.height = last.current.height;
    void generate(next);
  }, [generate]);

  const cancel = useCallback(() => {
    controller.current?.abort();
    setStatus(current.current ? 'done' : 'idle');
  }, []);

  return { status, image, error, attempt, isGenerating: status === 'generating', generate, retry, again, cancel };
}
