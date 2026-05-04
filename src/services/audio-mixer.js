const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const execFileAsync = promisify(execFile);

// Get duration in seconds of a media file using ffprobe
async function getAudioDuration(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
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
      `[1:a]volume=0.15,`,
      `afade=t=in:d=2,`,
      `afade=t=out:st=${fadeOutStart}:d=3`,
      `[music];`,
      `[0:a][music]amix=inputs=2:duration=first[out]`,
    ].join('');

    await execFileAsync('ffmpeg', [
      '-y',
      '-i', voicePath,
      '-i', musicPath,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-ac', '1',
      '-b:a', '128k',
      '-ar', '44100',
      '-af', 'loudnorm=I=-16:LRA=11:TP=-1.5',
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

module.exports = { mixVoiceWithMusic };
