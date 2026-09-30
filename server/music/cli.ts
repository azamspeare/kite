// Usage: npm run analyze -- <audio-or-video file> [--json]
import { performance } from 'node:perf_hooks';
import { ANALYSIS_SAMPLE_RATE, decodeAudio } from './decode';
import { analyzeSignal } from './analyze';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const asJson = args.includes('--json');

if (!file) {
  console.error('Usage: npm run analyze -- <audio file> [--json]');
  process.exit(1);
}

const t0 = performance.now();
const signal = await decodeAudio(file, ANALYSIS_SAMPLE_RATE);
const t1 = performance.now();
const result = analyzeSignal(signal, ANALYSIS_SAMPLE_RATE);
const t2 = performance.now();

if (asJson) {
  console.log(JSON.stringify(result));
} else {
  const fmt = (xs: number[], n = 8) =>
    xs
      .slice(0, n)
      .map((t) => t.toFixed(3))
      .join(', ') + (xs.length > n ? `, … (${xs.length})` : '');
  const ibi = result.beats.slice(1).map((t, i) => t - result.beats[i]);
  const ibiMean = ibi.reduce((a, b) => a + b, 0) / (ibi.length || 1);
  const ibiSd = Math.sqrt(ibi.reduce((a, b) => a + (b - ibiMean) ** 2, 0) / (ibi.length || 1));
  console.log(`file       ${file}`);
  console.log(`duration   ${result.duration.toFixed(2)} s`);
  console.log(`bpm        ${result.bpm}`);
  console.log(`beats      ${result.beats.length}  (IBI ${(ibiMean * 1000).toFixed(1)} ± ${(ibiSd * 1000).toFixed(1)} ms)`);
  console.log(`           ${fmt(result.beats)}`);
  console.log(`downbeats  ${result.downbeats.length}`);
  console.log(`           ${fmt(result.downbeats)}`);
  console.log(`phrases    ${result.phrases.length}`);
  console.log(`           ${fmt(result.phrases, 12)}`);
  console.log(`sections   ${result.sections.length}`);
  for (const s of result.sections) {
    console.log(
      `           ${s.start.toFixed(2).padStart(7)} → ${s.end.toFixed(2).padStart(7)}  ${s.label.padEnd(6)} energy ${s.energy.toFixed(2)}`,
    );
  }
  const strongest = [...result.accents].sort((a, b) => b.strength - a.strength).slice(0, 6);
  console.log(
    `accents    ${result.accents.length}  strongest: ${strongest.map((a) => `${a.t.toFixed(2)}s(${a.strength})`).join(', ')}`,
  );
  console.log(`timing     decode ${(t1 - t0).toFixed(0)} ms, analyze ${(t2 - t1).toFixed(0)} ms`);
}
