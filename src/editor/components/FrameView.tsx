import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { FrameApi, FrameMessage } from '../../shared/frameApi';
import type { SoundReport } from '../../shared/types';

export interface FrameHandle {
  api(): FrameApi | null;
  render(t: number): void;
}

interface Props {
  projectId: string;
  /** Scene frames pass a scene id (switching scenes doesn't reload the page); omit for the whole video. */
  sceneId?: string | null;
  mode: 'editor' | 'thumb' | 'present';
  /** When set, the frame renders this time (used by thumbnails). */
  time?: number;
  className?: string;
  title?: string;
  onReady?: () => void;
  onErrors?: (errors: string[]) => void;
  /** Whole-video frames report every scene's sound cues after each reload that changes them. */
  onSounds?: (report: SoundReport) => void;
}

/** Same-origin iframe running frame.html; exposes its FrameApi. */
export const FrameView = forwardRef<FrameHandle, Props>(function FrameView(props, ref) {
  const { projectId, sceneId, mode, time, className, title } = props;
  const iframe = useRef<HTMLIFrameElement>(null);
  const apiRef = useRef<FrameApi | null>(null);
  const [ready, setReady] = useState(false);
  const callbacks = useRef(props);
  callbacks.current = props;
  const firstScene = useRef(sceneId);
  const isSceneFrame = sceneId !== undefined;

  const src = useMemo(() => {
    const q = new URLSearchParams({ project: projectId, mode });
    if (isSceneFrame && firstScene.current) q.set('scene', firstScene.current);
    if (time !== undefined) q.set('t', String(time));
    return `/frame.html?${q}`;
    // The page is only (re)loaded when the project or mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, mode, isSceneFrame]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!iframe.current || e.source !== iframe.current.contentWindow) return;
      const msg = e.data as FrameMessage;
      if (msg?.source !== 'sb-frame') return;
      if (msg.type === 'ready') {
        apiRef.current = iframe.current.contentWindow?.__sb ?? null;
        setReady(true);
        callbacks.current.onReady?.();
      } else if (msg.type === 'errors') {
        callbacks.current.onErrors?.(msg.errors);
      } else if (msg.type === 'sounds') {
        callbacks.current.onSounds?.(msg.report);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (ready && isSceneFrame && sceneId) {
      void apiRef.current?.setScene(sceneId).then(() => {
        if (callbacks.current.time !== undefined) apiRef.current?.render(callbacks.current.time);
        callbacks.current.onReady?.();
      });
    }
  }, [ready, sceneId, isSceneFrame]);

  useEffect(() => {
    if (ready && time !== undefined) apiRef.current?.render(time);
  }, [ready, time]);

  useImperativeHandle(ref, () => ({
    api: () => apiRef.current,
    render: (t: number) => {
      apiRef.current?.render(t);
    },
  }));

  return (
    <iframe
      ref={iframe}
      src={src}
      className={className}
      title={title ?? 'Scene preview'}
      loading={mode === 'thumb' ? 'lazy' : undefined}
    />
  );
});
