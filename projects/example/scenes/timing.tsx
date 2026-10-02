import type { CSSProperties } from 'react';
import { Fill, ease, mix, mixColor, progress, spring, type SceneProps, type SceneSounds } from 'kite';
import { Headline, swapWords } from '../components/Headline';
import { LogoMark, MARK_BARS, MARK_RADIUS, MARK_SIZE } from '../components/LogoMark';
import { PILLS_TOP, Pills, STYLE_LABELS } from '../components/Pills';
import { LOOKS, PromptCard } from '../components/PromptCard';
import { BG, BLUE, CARD, DISPLAY, GRAY, INK, LIGHT, LINE, MONO, PINK } from '../components/tokens';

// The timeline maps scene time 0…5 s onto x 380…1580, so the playhead crosses each tick on the real beat.
const X0 = 380;
const X1 = 1580;
const SPAN = 5;
const PPS = (X1 - X0) / SPAN;
const xAt = (time: number) => X0 + time * PPS;

const PANEL = { x: 290, y: 410, w: 1340, h: 362 };
const RULER_Y = 490;
const TRACK_Y = [526, 604, 682];
const CLIP_H = 48;

const CLIPS = [
  { label: 'Headline', from: 0.5, to: 2.0, track: 0, bg: '#efeff2', ink: '#3f3f46' },
  { label: 'Card', from: 1.0, to: 3.0, track: 1, bg: PINK, ink: '#ffffff' },
  { label: 'Logo', from: 2.5, to: 4.5, track: 2, bg: '#efeff2', ink: '#3f3f46' },
];

/** Keyframes placed slightly off the grid; each snaps to its beat as the playhead reaches it. */
const KEYS = [
  { track: 0, from: 1.62 },
  { track: 1, from: 2.13 },
  { track: 1, from: 2.63 },
  { track: 2, from: 3.12 },
];

const MARK_X = 960 - MARK_SIZE / 2;
const MARK_Y = 540 - MARK_SIZE / 2;
const MARK_DONE = 4.3;

/** Moments shared by the animation and the sound cues. */
const snapAt = (music: SceneProps['music'], from: number) => music.snap(from, 'beat');
const LEAVE_LEN = 0.45;
const FLY_AT = 3.45;
const FLY_LEN = 0.65;
const SQUARE_AT = 3.85;

export const sounds: SceneSounds = ({ music }) => [
  { at: LEAVE_LEN / 3, sound: 'swish', align: 'peak', pitch: -4, volume: 0.4 },
  ...KEYS.map((k, i) => ({ at: snapAt(music, k.from), sound: 'blip', pitch: [0, 2, 4, 7][i], volume: 0.6 })),
  { at: FLY_AT + FLY_LEN / 2, sound: 'whoosh', align: 'peak', pitch: 2, volume: 0.75 },
  { at: SQUARE_AT, sound: 'pop', pitch: -5, volume: 0.6 },
  { at: FLY_AT + FLY_LEN, sound: 'thud', volume: 0.75 },
];

function Diamond({ x, y, color, scale }: { x: number; y: number; color: string; scale: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 8,
        top: y - 8,
        width: 16,
        height: 16,
        borderRadius: 3,
        background: color,
        border: '2px solid #ffffff',
        transform: `rotate(45deg) scale(${scale})`,
      }}
    />
  );
}

export default function Timing({ t, music }: SceneProps) {
  // Hand-off from "Every style": card and pills drop away.
  const leave = progress(t, 0, LEAVE_LEN, ease.inCubic);
  const pillsLeave = progress(t, 0, 0.3, ease.inCubic);

  const swap = progress(t, 0.05, 0.9);
  const sub = progress(t, 0.45, 0.95, ease.outExpo);
  const exit = progress(t, 3.4, 3.78, ease.inCubic);

  const panelIn = progress(t, 0.5, 1.05, ease.outExpo);
  const rise = (1 - panelIn) * 30;
  const panelOpacity = panelIn * (1 - progress(t, 3.38, 3.7, ease.inCubic));

  const beats = music.beats.filter((b) => b >= -1e-6 && b <= SPAN + 1e-6);
  const downbeats = new Set(music.downbeats.map((d) => Math.round(d * 1000)));
  let bar = 0;

  const headlineStyle: CSSProperties | undefined =
    exit > 0 ? { opacity: 1 - exit, transform: `translateY(${-36 * exit}px)` } : undefined;

  const square = progress(t, SQUARE_AT, SQUARE_AT + 0.4, ease.outBack);
  const barColor = progress(t, 3.95, MARK_DONE);

  return (
    <Fill style={{ background: BG }}>
      {leave < 1 && (
        <PromptCard
          look={LOOKS.soft}
          style={
            leave > 0
              ? {
                  left: CARD.x,
                  top: CARD.y,
                  opacity: 1 - leave,
                  transform: `translateY(${70 * leave}px) scale(${1 - 0.04 * leave})`,
                }
              : { left: CARD.x, top: CARD.y }
          }
        />
      )}
      {pillsLeave < 1 && (
        <Pills
          labels={STYLE_LABELS}
          active={4}
          centerX={960}
          top={PILLS_TOP}
          style={pillsLeave > 0 ? { opacity: 1 - pillsLeave, transform: `translateY(${30 * pillsLeave}px)` } : undefined}
        />
      )}

      {t < 3.8 && <Headline words={swapWords('Every', ['style'], ['beat.'], swap)} style={headlineStyle} />}
      {sub > 0 && exit < 1 && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 250,
            textAlign: 'center',
            fontFamily: DISPLAY,
            fontSize: 46,
            fontWeight: 600,
            letterSpacing: '-0.03em',
            color: LIGHT,
            opacity: sub * (1 - exit),
            transform: `translateY(${(1 - sub) * 16 - 30 * exit}px)`,
          }}
        >
          Down to the millisecond.
        </div>
      )}

      {panelOpacity > 0 && (
        <div style={{ position: 'absolute', inset: 0, opacity: panelOpacity, transform: `translateY(${rise}px)` }}>
          <div
            style={{
              position: 'absolute',
              left: PANEL.x,
              top: PANEL.y,
              width: PANEL.w,
              height: PANEL.h,
              borderRadius: 24,
              background: '#ffffff',
              border: `1px solid ${LINE}`,
              boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 24px 60px rgba(0,0,0,0.07)',
            }}
          />
          <div
            style={{ position: 'absolute', left: PANEL.x + 30, top: PANEL.y + 22, fontFamily: MONO, fontSize: 16, color: GRAY }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 4,
                background: BLUE,
                marginRight: 10,
                verticalAlign: 1,
              }}
            />
            {Math.max(0, t).toFixed(3)}s
          </div>
          {beats.map((b, i) => {
            const x = xAt(b);
            const drawn = progress(t, 0.7 + (b / SPAN) * 0.5, 0.9 + (b / SPAN) * 0.5, ease.outCubic);
            const flash = t >= b ? Math.exp(-7 * (t - b)) : 0;
            const isDown = downbeats.has(Math.round(b * 1000));
            if (isDown) bar++;
            const h = (isDown ? 22 : 12) + 10 * flash;
            return (
              <div key={i}>
                <div
                  style={{
                    position: 'absolute',
                    left: x - 0.5,
                    top: RULER_Y + 26,
                    width: 1,
                    height: 232 * drawn,
                    background: '#f0f0f3',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: x - 1,
                    top: RULER_Y + 18 - h,
                    width: 2,
                    height: h * drawn,
                    borderRadius: 1,
                    background: mixColor(isDown ? '#8a8a8f' : '#c9c9ce', PINK, flash),
                  }}
                />
                {isDown && (
                  <div
                    style={{
                      position: 'absolute',
                      left: x + 6,
                      top: RULER_Y - 26,
                      fontFamily: MONO,
                      fontSize: 13,
                      color: mixColor('#a1a1aa', PINK, flash),
                      opacity: drawn,
                    }}
                  >
                    {bar}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {t >= MARK_DONE ? (
        <LogoMark x={MARK_X} y={MARK_Y} />
      ) : (
        <>
          {square > 0 && (
            <div
              style={{
                position: 'absolute',
                left: MARK_X,
                top: MARK_Y,
                width: MARK_SIZE,
                height: MARK_SIZE,
                borderRadius: MARK_RADIUS,
                background: '#18181b',
                opacity: Math.min(1, square * 1.5),
                transform: `scale(${mix(0.55, 1, square)})`,
              }}
            />
          )}
          {CLIPS.map((clip, i) => {
            const grow = progress(t, 0.8 + i * 0.12, 1.35 + i * 0.12, ease.outExpo);
            if (grow <= 0) return null;
            const fly = progress(t, FLY_AT + i * 0.06, FLY_AT + FLY_LEN + i * 0.06, ease.inOutCubic);
            const target = MARK_BARS[i];
            const fromX = xAt(clip.from);
            const fromW = (clip.to - clip.from) * PPS * grow;
            const x = mix(fromX, MARK_X + target.x, fly);
            const y = mix(TRACK_Y[clip.track] + rise, MARK_Y + target.y, fly);
            const w = mix(fromW, target.w, fly);
            const h = mix(CLIP_H, target.h, fly);
            const label = (1 - progress(t, 3.42, 3.62)) * progress(t, 1.0 + i * 0.12, 1.4 + i * 0.12);
            return (
              <div
                key={clip.label}
                style={{
                  position: 'absolute',
                  left: x,
                  top: y,
                  width: w,
                  height: h,
                  borderRadius: mix(12, target.h / 2, fly),
                  background: mixColor(clip.bg, target.color, barColor),
                  boxShadow: `inset 0 0 0 1px rgba(0,0,0,${0.06 * (1 - fly)})`,
                  opacity: fly > 0 ? 1 : panelIn,
                  overflow: 'hidden',
                }}
              >
                {label > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      left: 16,
                      top: 0,
                      lineHeight: `${CLIP_H}px`,
                      fontFamily: DISPLAY,
                      fontSize: 17,
                      fontWeight: 550,
                      color: clip.ink,
                      opacity: label,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {clip.label}
                  </span>
                )}
              </div>
            );
          })}
        </>
      )}
      {panelOpacity > 0 && (
        <div style={{ position: 'absolute', inset: 0, opacity: panelOpacity, transform: `translateY(${rise}px)` }}>
          {KEYS.map((k, i) => {
            const target = snapAt(music, k.from);
            const y = TRACK_Y[k.track] + CLIP_H / 2;
            const pop = progress(t, 1.05 + i * 0.05, 1.3 + i * 0.05, ease.outBack);
            const snapped = t >= target;
            const x = snapped
              ? spring(t - target, { from: xAt(k.from), to: xAt(target), stiffness: 520, damping: 24 })
              : xAt(k.from);
            const ring = snapped ? progress(t, target, target + 0.45, ease.outCubic) : 0;
            return (
              <div key={i}>
                {ring > 0 && ring < 1 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: xAt(target) - 26,
                      top: y - 26,
                      width: 52,
                      height: 52,
                      borderRadius: 26,
                      border: `2px solid ${PINK}`,
                      opacity: 1 - ring,
                      transform: `scale(${0.3 + ring * 0.9})`,
                    }}
                  />
                )}
                {pop > 0 && <Diamond x={x} y={y} color={snapped ? INK : '#a1a1aa'} scale={pop} />}
              </div>
            );
          })}
          {t >= 0.5 && (
            <div
              style={{
                position: 'absolute',
                left: xAt(Math.min(t, SPAN)) - 1,
                top: RULER_Y - 38,
                width: 2,
                height: 272,
                background: BLUE,
              }}
            >
              <div
                style={{ position: 'absolute', left: -6, top: -4, width: 14, height: 14, borderRadius: 4, background: BLUE }}
              />
            </div>
          )}
        </div>
      )}
    </Fill>
  );
}
