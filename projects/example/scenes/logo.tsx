import { Fill, ease, mix, progress, type SceneProps, type SceneSounds } from 'storyboard';
import { LogoMark, MARK_SIZE } from '../components/LogoMark';
import { BG, DISPLAY, GRAY, INK } from '../components/tokens';

const START_X = 960 - MARK_SIZE / 2;
const MARK_Y = 540 - MARK_SIZE / 2;
/** Final lockup: mark + 44 px gap + wordmark, centred as a group. */
const WORD_SIZE = 132;
const WORD_WIDTH = 630;
const GAP = 44;
const LOCKUP_X = 960 - (MARK_SIZE + GAP + WORD_WIDTH) / 2;

/** Moments shared by the animation and the sound cues. */
const SLIDE_AT = 0.25;
const REVEAL_AT = 0.3;
const TAGLINE_AT = 1.15;

export const sounds: SceneSounds = [
  { at: REVEAL_AT, sound: 'riser', align: 'peak', volume: 0.5 },
  { at: REVEAL_AT, sound: 'impact', volume: 0.9 },
  { at: TAGLINE_AT, sound: 'sparkle', volume: 0.5 },
];

export default function Logo({ t, music }: SceneProps) {
  const slide = progress(t, SLIDE_AT, SLIDE_AT + 0.85, ease.smooth);
  const markX = mix(START_X, LOCKUP_X, slide);
  const reveal = progress(t, REVEAL_AT, REVEAL_AT + 0.85, ease.outExpo);
  const tagline = progress(t, TAGLINE_AT, TAGLINE_AT + 0.6, ease.outExpo);
  // Once the lockup has settled, the clips in the mark nudge on each bar line of the music.
  const live = progress(t, 1.6, 2.0);
  const barScale = (i: number) => 1 + 0.09 * live * music.pulse(t - i * 0.07, { grid: 'bar', decay: 5 });

  return (
    <Fill style={{ background: BG }}>
      {reveal > 0 && (
        // The wordmark slides out from behind the mark's trailing edge.
        <div
          style={{
            position: 'absolute',
            left: markX + MARK_SIZE + GAP - 8,
            top: MARK_Y - 20,
            width: WORD_WIDTH + 40,
            height: MARK_SIZE + 40,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 8,
              top: 20,
              lineHeight: `${MARK_SIZE}px`,
              fontFamily: DISPLAY,
              fontSize: WORD_SIZE,
              fontWeight: 700,
              letterSpacing: '-0.045em',
              color: INK,
              whiteSpace: 'nowrap',
              transform: reveal < 1 ? `translateX(${-(1 - reveal) * (WORD_WIDTH + 24)}px)` : undefined,
            }}
          >
            Storyboard
          </div>
        </div>
      )}
      <LogoMark x={markX} y={MARK_Y} barScale={live > 0 ? barScale : undefined} />
      {tagline > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: MARK_Y + MARK_SIZE + 58,
            textAlign: 'center',
            fontFamily: DISPLAY,
            fontSize: 38,
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: GRAY,
            opacity: tagline,
            transform: `translateY(${(1 - tagline) * 14}px)`,
          }}
        >
          Make videos by describing them.
        </div>
      )}
    </Fill>
  );
}
