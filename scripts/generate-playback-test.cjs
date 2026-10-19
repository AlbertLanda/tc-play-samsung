// Optional developer utility; FFmpeg is only needed to regenerate this bundled asset.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const filter = '[0:v]drawtext=text=TC PLAY - PRUEBA LOCAL:fontcolor=white:fontsize=30:x=30:y=25,' +
  'drawtext=text=Movimiento continuo + tono continuo:fontcolor=white:fontsize=22:x=30:y=80,' +
  'drawtext=text=%{n}:fontcolor=white:fontsize=50:x=(w-text_w)/2:y=185,' +
  'drawtext=text=Sin internet ni Xtream:fontcolor=white:fontsize=22:x=30:y=425[base];' +
  '[base][1:v]overlay=x=mod(t*90\\,656):y=310[v]';
const result = spawnSync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'color=c=0x101a2c:s=720x480:r=30:d=20',
  '-f', 'lavfi', '-i', 'color=c=0x46d8fa:s=64x64:r=30:d=20',
  '-f', 'lavfi', '-i', 'aevalsrc=0.08*sin(2*PI*(400*t+10*t*t)):s=48000:d=20',
  '-filter_complex', filter, '-map', '[v]', '-map', '2:a',
  '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.0', '-pix_fmt', 'yuv420p',
  '-crf', '28', '-preset', 'medium', '-g', '30', '-c:a', 'aac', '-b:a', '48k',
  '-ar', '48000', '-ac', '1', '-movflags', '+faststart', '-shortest',
  path.join(__dirname, '../src/assets/playback-test.mp4')
], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
