// ffmpeg / sharp helpers
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { safeRequire } = require('./utils');

const ffmpegPath = safeRequire('ffmpeg-static') || 'ffmpeg';
async function ff(buffer, args, outExt) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const inp = path.join(os.tmpdir(), `${id}.in`), out = path.join(os.tmpdir(), `${id}.${outExt}`);
  fs.writeFileSync(inp, buffer);
  try {
    await new Promise((res, rej) => {
      const p = spawn(ffmpegPath, ['-y', '-i', inp, ...args, out], { stdio: 'ignore' });
      p.on('error', rej); p.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`))));
    });
    return fs.readFileSync(out);
  } finally { for (const f of [inp, out]) fs.rm(f, () => {}); }
}
const toMp3 = (buf) => ff(buf, ['-vn', '-ac', '2', '-b:a', '128k'], 'mp3');
const videoToWebp = (buf) => ff(buf, ['-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=12,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000', '-c:v', 'libwebp', '-q:v', '45', '-loop', '0', '-t', '8', '-an'], 'webp');
const imgToSticker = (buf) => sharp(buf).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 80 }).toBuffer();
const stickerToPng = (buf) => sharp(buf).png().toBuffer();
module.exports = { ff, toMp3, videoToWebp, imgToSticker, stickerToPng };
