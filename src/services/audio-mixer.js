const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const logger = require('../utils/logger');

const FFMPEG_PATH = ffmpegInstaller.path;
const FFPROBE_PATH = ffprobeInstaller.path;

const execFileAsync = promisify(execFile);

// Get duration in seconds of a media file using ffprobe
async function getAudioDuration(filePath) {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v', 'quiet',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  return parseFloat(stdout.trim());
}

// Write buffer to a temp file, returning its path
function writeTmp(buffer, suffix) {
  const filePath = path.join('/tmp', `audio-mix-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function safeUnlink(filePath) {
  try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
}

const BACKGROUND_MUSIC_URL = 'https://dapxhktnsszbqhxyqmde.supabase.co/storage/v1/object/public/audios/music/background.mp3';
const BACKGROUND_MUSIC_PATH = '/tmp/background-music.mp3';

// Download the background track once and cache it locally in /tmp.
async function ensureBackgroundMusic() {
  if (fs.existsSync(BACKGROUND_MUSIC_PATH)) return BACKGROUND_MUSIC_PATH;
  logger.info('audio-mixer: downloading background music');
  const res = await fetch(BACKGROUND_MUSIC_URL);
  if (!res.ok) throw new Error(`Failed to download background music: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(BACKGROUND_MUSIC_PATH, buf);
  logger.info('audio-mixer: background music cached', { bytes: buf.length });
  return BACKGROUND_MUSIC_PATH;
}

/**
 * Mix voice buffer with a background music file.
 * @param {Buffer} voiceBuffer  MP3 buffer from ElevenLabs
 * @param {string} musicPath    Absolute path to background music file (cached locally)
 * @returns {Promise<Buffer>}   MP3 buffer of the final mix
 */
async function mixVoiceWithMusic(voiceBuffer, musicPath) {
  const voicePath = writeTmp(voiceBuffer, '.mp3');
  const outputPath = path.join('/tmp', `audio-mix-out-${Date.now()}.mp3`);

  try {
    const voiceDuration = await getAudioDuration(voicePath);
    const fadeOutStart = Math.max(0, voiceDuration - 3);

    const filterComplex = [
      `[1:a]volume=0.35,`,
      `afade=t=in:d=2,`,
      `afade=t=out:st=${fadeOutStart}:d=3`,
      `[music];`,
      `[0:a][music]amix=inputs=2:duration=first`,
      `[out]`,
    ].join('');

    await execFileAsync(FFMPEG_PATH, [
      '-y',
      '-i', voicePath,
      '-i', musicPath,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-ac', '1',
      '-b:a', '128k',
      '-ar', '44100',
      outputPath,
    ]);

    const result = fs.readFileSync(outputPath);
    logger.info('audio-mixer: mix complete', { voiceDuration, outputBytes: result.length });
    return result;
  } finally {
    safeUnlink(voicePath);
    safeUnlink(outputPath);
  }
}

module.exports = { mixVoiceWithMusic, ensureBackgroundMusic, BACKGROUND_MUSIC_PATH };
