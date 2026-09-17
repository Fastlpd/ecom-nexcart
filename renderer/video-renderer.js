const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static');
const { launchBrowser } = require('../core/puppeteer');

function resolveBinaryPath(candidate) {
  if (typeof candidate === 'string') return candidate;
  if (candidate && typeof candidate === 'object') {
    if (typeof candidate.path === 'string') return candidate.path;
    if (typeof candidate.default === 'string') return candidate.default;
    if (typeof candidate.bin === 'string') return candidate.bin;
  }
  return '';
}

const resolvedFfmpegPath = resolveBinaryPath(ffmpegPath);
const resolvedFfprobePath = resolveBinaryPath(ffprobePath);
if (resolvedFfmpegPath) {
  ffmpeg.setFfmpegPath(resolvedFfmpegPath);
}
if (resolvedFfprobePath) {
  ffmpeg.setFfprobePath(resolvedFfprobePath);
}

class VideoRenderValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VideoRenderValidationError';
    this.statusCode = 400;
  }
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function logRenderEvent(event, details) {
  const timestamp = new Date().toISOString();
  if (details !== undefined) {
    console.log(`[render-video] ${timestamp} ${event}`, details);
  } else {
    console.log(`[render-video] ${timestamp} ${event}`);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function normalizeArtifactAvoidance(promptText) {
  const defaultAvoidList = [
    'text distortion',
    'extra fingers',
    'floating objects',
    'ui glitches',
    'warped screens',
    'duplicate hands',
    'low quality',
    'noise',
    'compression artifacts',
    'cheap animation',
    'blurry interface',
    'camera shake',
    'oversaturation',
    'unnatural movement',
    'flickering',
    'incorrect reflections'
  ];
  const normalizedPrompt = String(promptText || '').toLowerCase();
  const extracted = defaultAvoidList.filter((phrase) => normalizedPrompt.includes(phrase.toLowerCase()));
  return Array.from(new Set([...defaultAvoidList, ...extracted]));
}

function normalizeEmotionProfile(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const source = [data.emotion, data.feeling, data.mood, data.emotions, data.feelings, data.tone]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ');
  const text = String(source || '').toLowerCase();
  const profile = {
    confidence: /confidence|confident|assured|bold/.test(text),
    innovation: /innovation|innovative|future|forward|creative|vision/.test(text),
    speed: /speed|fast|rapid|agile|instant|efficient|lightning/.test(text),
    premium_quality: /premium|quality|high[- ]end|elite|refined|excellent|top[- ]tier/.test(text),
    trust: /trust|trusted|reliable|secure|dependable|safe|calm/.test(text),
    luxury_software: /luxury|software|elegant|polished|beautiful/.test(text)
  };
  const summaryLabels = [];
  if (profile.confidence) summaryLabels.push('Confidence');
  if (profile.innovation) summaryLabels.push('Innovation');
  if (profile.speed) summaryLabels.push('Speed');
  if (profile.premium_quality) summaryLabels.push('Premium quality');
  if (profile.trust) summaryLabels.push('Trust');
  if (profile.luxury_software) summaryLabels.push('Luxury software');
  return {
    ...profile,
    summary: summaryLabels.join(' • ')
  };
}

function normalizeSoundtrackProfile(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const source = [data.soundtrack, data.audio_style, data.music_style, data.audio_profile, data.sound_design, data.music]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ');
  const text = String(source || '').toLowerCase();
  const profile = {
    energetic: /energetic|energy|uplifting|pulse/.test(text),
    cinematic: /cinematic|cinema|epic|dramatic|grand/.test(text),
    electronic: /electronic|synth|techno|ambient/.test(text),
    subtle_risers: /subtle|risers|rise|build/.test(text),
    modern_bass: /modern bass|bass|deep bass|low end/.test(text),
    inspirational_ending: /inspirational|ending|hero|uplift|hope/.test(text)
  };
  const labels = [];
  if (profile.energetic) labels.push('Energetic');
  if (profile.cinematic) labels.push('Cinematic');
  if (profile.electronic) labels.push('Electronic');
  if (profile.subtle_risers) labels.push('Subtle risers');
  if (profile.modern_bass) labels.push('Modern bass');
  if (profile.inspirational_ending) labels.push('Inspirational ending');
  return {
    ...profile,
    summary: labels.join(' • ')
  };
}

function normalizeVideoRenderPayload(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const isTestMode = data.test_mode === true || data.testMode === true || data.mode === 'test';
  const creativePrompt = String(data.creative_prompt || data.prompt || data.video_prompt || '').trim();
  const negativePrompt = String(data.negative_prompt || data.avoid || data.negative_prompt_text || '').trim();
  const emotionProfile = normalizeEmotionProfile(data);
  const soundtrackProfile = normalizeSoundtrackProfile(data);
  const useCinematicDefaults = Boolean(creativePrompt) || data.style === 'cinematic' || data.cinematic === true;
  const resolutionMatch = String(data.resolution || data.size || '').match(/(\d+)\s*x\s*(\d+)/i);
  const fallbackWidth = Number(data.width ?? (resolutionMatch ? resolutionMatch[1] : 1920));
  const fallbackHeight = Number(data.height ?? (resolutionMatch ? resolutionMatch[2] : 1080));
  const width = isTestMode ? 720 : Number(fallbackWidth || 1080);
  const height = isTestMode ? 1280 : Number(fallbackHeight || 1920);
  const duration = isTestMode ? 3 : Number(data.duration ?? (useCinematicDefaults ? 30 : 40));
  const fps = isTestMode ? 12 : Number(data.fps ?? (useCinematicDefaults ? 24 : 30));
  const quality = String(data.quality || data.render_quality || '').toLowerCase();
  const isHighQuality = quality === 'high' || quality === 'hd' || quality === '4k' || quality === 'ultra';
  const imageUrls = Array.isArray(data.image_urls) ? data.image_urls.filter(Boolean) : [];
  const images = imageUrls.length > 0 ? imageUrls : (data.image_url ? [data.image_url] : []);
  const voiceoverEnabled = data.voiceover_enabled === false || data.voiceover_enabled === 'false' ? false : Boolean(data.voiceover_audio_url || data.voiceover_text);
  const backgroundMusicVolume = Number(data.background_music_volume || 0.12);
  const voiceoverVolume = Number(data.voiceover_volume || 1.0);
  return {
    ...data,
    format: String(data.format || 'mp4').toLowerCase(),
    platform: String(data.platform || 'tiktok').toLowerCase(),
    width: Number.isFinite(width) ? Math.round(width) : 1080,
    height: Number.isFinite(height) ? Math.round(height) : 1920,
    duration: Number.isFinite(duration) ? Math.round(duration) : 40,
    fps: Number.isFinite(fps) ? Math.round(fps) : 30,
    quality: quality || (isHighQuality ? 'high' : 'standard'),
    test_mode: isTestMode,
    image_urls: images,
    image_url: images[0] || '',
    creative_prompt: creativePrompt,
    negative_prompt: negativePrompt,
    avoid_list: normalizeArtifactAvoidance(negativePrompt || creativePrompt),
    emotion_profile: emotionProfile,
    emotion_summary: emotionProfile.summary,
    soundtrack_profile: soundtrackProfile,
    soundtrack_summary: soundtrackProfile.summary,
    voiceover_enabled: voiceoverEnabled,
    background_music_volume: Number.isFinite(backgroundMusicVolume) ? backgroundMusicVolume : 0.12,
    voiceover_volume: Number.isFinite(voiceoverVolume) ? voiceoverVolume : 1.0,
    brand_name: String(data.brand_name || '').trim(),
    logo_url: String(data.logo_url || '').trim(),
    hashtags: String(data.hashtags || '').trim(),
    subtitle: String(data.subtitle || '').trim(),
    benefit1: String(data.benefit1 || '').trim(),
    benefit2: String(data.benefit2 || '').trim(),
    benefit3: String(data.benefit3 || '').trim(),
    voiceover_text: String(data.voiceover_text || '').trim(),
    voiceover_audio_url: String(data.voiceover_audio_url || '').trim(),
    background_music_url: String(data.background_music_url || '').trim(),
    product_url: String(data.product_url || '').trim(),
    product_title: String(data.product_title || '').trim(),
    hook: String(data.hook || '').trim(),
    script: String(data.script || '').trim(),
    caption: String(data.caption || '').trim(),
    cta: String(data.cta || '').trim(),
    benefit1: String(data.benefit1 || '').trim(),
    benefit2: String(data.benefit2 || '').trim(),
    benefit3: String(data.benefit3 || '').trim()
  };
}

function validateVideoRenderPayload(payload) {
  const data = normalizeVideoRenderPayload(payload);
  const format = data.format;
  if (format !== 'mp4') {
    throw new VideoRenderValidationError('Unsupported format. Only mp4 is currently supported.');
  }

  const supportedPlatforms = ['tiktok', 'instagram', 'reels', 'facebook', 'pinterest', 'youtube'];
  if (!supportedPlatforms.includes(data.platform)) {
    throw new VideoRenderValidationError('Unsupported platform. Use a supported social platform.');
  }

  const width = Number(data.width);
  const height = Number(data.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 3840 || height > 2160) {
    throw new VideoRenderValidationError('width and height must be sensible positive integers.');
  }

  if (!data.product_title) {
    throw new VideoRenderValidationError('product_title is required.');
  }

  if (data.image_url && !isValidHttpUrl(data.image_url)) {
    throw new VideoRenderValidationError('image_url must be a valid http or https URL.');
  }
  if (Array.isArray(data.image_urls) && data.image_urls.some((value) => value && !isValidHttpUrl(value))) {
    throw new VideoRenderValidationError('image_urls must contain valid http or https URLs.');
  }

  const duration = Number(data.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60) {
    throw new VideoRenderValidationError('duration must be a positive number of seconds up to 60.');
  }

  const fps = Number(data.fps);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 60) {
    throw new VideoRenderValidationError('fps must be a positive number up to 60.');
  }

  if (data.voiceover_audio_url && !isValidHttpUrl(data.voiceover_audio_url)) {
    throw new VideoRenderValidationError('voiceover_audio_url must be a valid http or https URL.');
  }
  if (data.background_music_url && !isValidHttpUrl(data.background_music_url)) {
    throw new VideoRenderValidationError('background_music_url must be a valid http or https URL.');
  }
  if (data.product_url && !isValidHttpUrl(data.product_url)) {
    throw new VideoRenderValidationError('product_url must be a valid http or https URL.');
  }

  return {
    ...data,
    images: data.image_urls.filter(Boolean)
  };
}

function truncateText(text, maxWords) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ')}…`;
}

function wrapText(text, maxChars) {
  const source = String(text || '').trim();
  if (!source) return '';
  if (source.length <= maxChars) return source;
  return `${source.slice(0, maxChars - 1)}…`;
}

function buildFrameMarkup(options, frameIndex) {
  const time = frameIndex / Math.max(1, Number(options.fps || 30));
  const duration = Number(options.duration || 40);
  const progress = clamp(time / Math.max(1, duration), 0, 1);
  const sceneIndex = Math.min(8, Math.floor(progress * 9));
  const sceneProgress = clamp((progress * 9) % 1, 0, 1);
  const eased = easeInOut(sceneProgress);
  const imageUrls = Array.isArray(options.image_urls) && options.image_urls.length > 0 ? options.image_urls : [options.image_url].filter(Boolean);
  const productImage = imageUrls[Math.min(imageUrls.length - 1, sceneIndex)] || imageUrls[0] || '';
  const hookText = truncateText(options.hook || 'Watch this now', 8);
  const subtitleText = truncateText(options.subtitle || options.product_title || 'Premium product showcase', 12);
  const benefit1Text = truncateText(options.benefit1 || 'Built for everyday ease', 12);
  const benefit2Text = truncateText(options.benefit2 || 'Easy to style and share', 12);
  const benefit3Text = truncateText(options.benefit3 || 'Made to stand out', 12);
  const problemText = truncateText(options.script || 'Designed for modern shoppers', 18);
  const solutionText = wrapText(options.caption || 'See how it delivers', 56);
  const ctaText = truncateText(options.cta || 'Shop now', 4);
  const brandName = options.brand_name || 'Nexcart';
  const hashtags = (options.hashtags || '').trim();
  const platformLabel = String(options.platform || 'tiktok').toUpperCase();
  const sceneTitle = ['Hook', 'Intro', 'Problem', 'Solution', 'Benefit 1', 'Benefit 2', 'Benefit 3', 'Recap', 'CTA'][sceneIndex] || 'Scene';

  const imageMarkup = productImage
    ? `<img class="product-image" src="${escapeHtml(productImage)}" alt="Product" />`
    : '<div class="placeholder">Product</div>';

  const sceneRows = [];
  if (sceneIndex === 0) {
    sceneRows.push(`<div class="hero-card" style="opacity:${0.15 + 0.85 * eased}; transform: translateY(${(1 - eased) * 120}px) scale(${1 + 0.06 * easeInOut(1 - sceneProgress)});">
      <div class="eyebrow">${escapeHtml(platformLabel)} • Scroll-stopping</div>
      <h1 class="headline">${escapeHtml(hookText)}</h1>
      <p class="subtitle">${escapeHtml(subtitleText)}</p>
    </div>`);
  } else if (sceneIndex === 1) {
    sceneRows.push(`<div class="scene-text" style="opacity:${0.2 + 0.8 * eased}; transform: translateX(${(0.5 - eased) * 40}px);">
      <div class="eyebrow">${escapeHtml(brandName)} • Premium launch</div>
      <h2 class="headline">${escapeHtml(options.product_title || 'Product Spotlight')}</h2>
      <p class="subtitle">${escapeHtml(subtitleText)}</p>
    </div>`);
  } else if (sceneIndex === 2) {
    sceneRows.push(`<div class="scene-text" style="opacity:${0.25 + 0.75 * eased}; transform: translateX(${(0.4 - eased) * 70}px) rotate(${(0.5 - eased) * 2}deg);">
      <div class="eyebrow">Customer tension</div>
      <h2 class="headline">${escapeHtml(problemText)}</h2>
    </div>`);
  } else if (sceneIndex === 3) {
    sceneRows.push(`<div class="scene-text" style="opacity:${0.3 + 0.7 * eased}; transform: translateY(${(0.3 - eased) * 40}px);">
      <div class="eyebrow">The solution</div>
      <h2 class="headline">${escapeHtml(solutionText)}</h2>
    </div>`);
  } else if (sceneIndex === 4) {
    sceneRows.push(`<div class="benefit-card" style="opacity:${0.35 + 0.65 * eased}; transform: translateX(${(0.25 - eased) * 90}px);"><div class="check">✓</div><div><h3>${escapeHtml(benefit1Text)}</h3><p>${escapeHtml(wrapText(options.script || 'Built for real-world use', 36))}</p></div></div>`);
  } else if (sceneIndex === 5) {
    sceneRows.push(`<div class="benefit-card" style="opacity:${0.4 + 0.6 * eased}; transform: translateX(${(0.25 - eased) * 90}px);"><div class="check">✓</div><div><h3>${escapeHtml(benefit2Text)}</h3><p>${escapeHtml(wrapText(options.caption || 'Feels effortless', 36))}</p></div></div>`);
  } else if (sceneIndex === 6) {
    sceneRows.push(`<div class="benefit-card" style="opacity:${0.45 + 0.55 * eased}; transform: translateX(${(0.25 - eased) * 90}px);"><div class="check">✓</div><div><h3>${escapeHtml(benefit3Text)}</h3><p>${escapeHtml(wrapText(options.subtitle || 'High impact detail', 36))}</p></div></div>`);
  } else if (sceneIndex === 7) {
    sceneRows.push(`<div class="chip-row" style="opacity:${0.5 + 0.5 * eased}; transform: translateY(${(0.2 - eased) * 50}px);">
      <span>${escapeHtml(benefit1Text)}</span>
      <span>${escapeHtml(benefit2Text)}</span>
      <span>${escapeHtml(benefit3Text)}</span>
    </div>`);
  } else {
    sceneRows.push(`<div class="cta-card" style="opacity:${0.55 + 0.45 * eased}; transform: translateY(${(0.25 - eased) * 60}px) scale(${1 + 0.03 * eased});">
      <div class="eyebrow">${escapeHtml(brandName)}</div>
      <h2 class="headline">${escapeHtml(ctaText)}</h2>
      <p>${escapeHtml(options.product_url || 'shop now')}</p>
      <div class="cta-button">${escapeHtml(ctaText)}</div>
    </div>`);
  }

  const imageStyle = `transform: translate3d(${(sceneIndex % 2 === 0 ? 4 : -4) * (1 - eased) * 12}px, ${(sceneIndex === 0 ? 22 : 6) * (1 - eased)}px, 0) scale(${1 + (sceneIndex === 0 ? 0.04 : 0.02) * eased});`;
  const sceneBadge = `<div class="scene-badge">${escapeHtml(sceneTitle)}</div>`;
  const hashtagMarkup = hashtags ? `<div class="tag-row">${hashtags.split(/\s+/).filter(Boolean).slice(0, 4).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : '';
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: dark; }
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: radial-gradient(circle at top, #2e1065 0%, #0f172a 45%, #020617 100%); font-family: Inter, Arial, sans-serif; color: #f8fafc; }
      body { display: flex; align-items: center; justify-content: center; overflow: hidden; }
      .frame { position: relative; width: ${options.width}px; height: ${options.height}px; overflow: hidden; border-radius: 36px; box-shadow: 0 20px 80px rgba(0,0,0,0.3); background: linear-gradient(135deg, rgba(14,165,233,0.28), rgba(236,72,153,0.25)); }
      .glow { position: absolute; inset: 0; background: radial-gradient(circle at 20% 20%, rgba(255,255,255,0.24), transparent 28%), radial-gradient(circle at 85% 15%, rgba(248,113,113,0.2), transparent 24%), radial-gradient(circle at 60% 85%, rgba(59,130,246,0.2), transparent 24%); pointer-events: none; }
      .product-card { position: absolute; right: 36px; top: 140px; width: ${Math.max(220, Math.min(360, options.width * 0.5))}px; height: ${Math.max(340, options.height * 0.5)}px; border-radius: 34px; padding: 20px; background: rgba(255,255,255,0.12); backdrop-filter: blur(24px); border: 1px solid rgba(255,255,255,0.2); box-shadow: 0 18px 50px rgba(0,0,0,0.24); overflow: hidden; ${imageStyle} }
      .product-image { width: 100%; height: 100%; object-fit: cover; border-radius: 24px; display: block; }
      .placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; border: 2px dashed rgba(255,255,255,0.3); border-radius: 24px; color: rgba(255,255,255,0.8); font-size: 24px; }
      .hero-card, .scene-text, .benefit-card, .cta-card { position: absolute; left: 36px; right: 36px; top: 80px; padding: 24px 28px; border-radius: 28px; background: rgba(2,6,23,0.48); border: 1px solid rgba(255,255,255,0.16); box-shadow: 0 18px 50px rgba(0,0,0,0.2); }
      .scene-text { top: 120px; }
      .hero-card { top: 96px; }
      .benefit-card { top: 120px; display: flex; gap: 16px; align-items: flex-start; }
      .benefit-card h3, .cta-card h2, .scene-text h2, .hero-card h1 { margin: 0 0 8px; font-size: 34px; line-height: 1.08; }
      .benefit-card p, .scene-text p, .hero-card p, .cta-card p { margin: 0; font-size: 22px; color: #e2e8f0; line-height: 1.3; }
      .eyebrow { display: inline-block; margin-bottom: 10px; padding: 7px 12px; border-radius: 999px; background: rgba(56,189,248,0.2); color: #bae6fd; font-size: 16px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .headline { font-size: 44px; line-height: 1.12; font-weight: 900; margin: 0 0 8px; }
      .subtitle { font-size: 24px; line-height: 1.34; color: #f8fafc; }
      .check { width: 46px; height: 46px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: linear-gradient(135deg, #34d399, #10b981); color: white; font-size: 24px; font-weight: 900; flex-shrink: 0; }
      .chip-row { position: absolute; left: 36px; right: 36px; bottom: 150px; display: flex; flex-wrap: wrap; gap: 12px; }
      .chip-row span { padding: 10px 16px; border-radius: 999px; background: rgba(255,255,255,0.16); color: white; font-size: 18px; }
      .tag-row { position: absolute; left: 36px; right: 36px; bottom: 92px; display: flex; flex-wrap: wrap; gap: 10px; }
      .tag-row span { padding: 8px 12px; border-radius: 999px; background: rgba(15,23,42,0.4); color: #e2e8f0; font-size: 16px; }
      .cta-button { display: inline-block; margin-top: 16px; padding: 12px 22px; border-radius: 999px; background: linear-gradient(135deg, #ec4899, #f59e0b); font-weight: 900; color: white; box-shadow: 0 10px 30px rgba(236,72,153,0.35); }
      .scene-badge { position: absolute; top: 24px; left: 24px; padding: 8px 12px; border-radius: 999px; background: rgba(255,255,255,0.16); color: white; font-weight: 700; font-size: 15px; }
    </style>
  </head>
  <body>
    <div class="frame">
      <div class="glow"></div>
      ${sceneBadge}
      <div class="product-card">${imageMarkup}</div>
      ${sceneRows.join('')}
    </div>
  </body>
</html>`;
}

function buildVideoHtml(options) {
  const images = Array.isArray(options.images) && options.images.length > 0 ? options.images : [options.image_url].filter(Boolean);
  const promptText = String(options.creative_prompt || options.prompt || options.video_prompt || '').trim();
  const isSaasCommercial = /saas|automation|workflow|creative workspace|designer|product video|commercial/i.test(promptText);
  const isLuxury = /luxury|apple|premium|minimal|futuristic|cinematic|clean modern/i.test(promptText);
  const productTitle = String(options.product_title || (isSaasCommercial ? 'Modern workflow studio' : 'Product Spotlight'));
  const hook = String(options.hook || (isSaasCommercial ? 'Build with calm confidence and cinematic clarity.' : 'A cinematic product reveal that feels premium'));
  const emotionSummary = String(options.emotion_summary || '').trim();
  const script = String(options.script || (emotionSummary ? 'Every interaction feels fast, polished, and unmistakably premium.' : (isSaasCommercial ? 'Colorful nodes connect smoothly as the workspace generates polished product videos in real time.' : 'Fluid automation, polished presentation, and market-ready output')));
  const caption = String(options.caption || (emotionSummary ? 'Confidence, innovation, and speed come together through a trusted luxury software experience.' : (isSaasCommercial ? 'The screen transforms into a premium ad with a beautiful hero finish.' : 'See the workflow come to life in real time')));
  const cta = String(options.cta || (emotionSummary ? 'Explore the experience' : 'Book a demo'));
  const brandName = String(options.brand_name || (isSaasCommercial ? 'Northstar AI' : 'Nexcart'));
  const subtitle = String(options.subtitle || (isSaasCommercial ? 'Luxury SaaS experience, crafted for modern teams.' : options.product_title || 'Premium commercial showcase'));
  const hashtags = String(options.hashtags || (isSaasCommercial ? '#saas #automation #cinematic' : '#cinematic #commercial #motion')).trim();
  const avoidList = Array.isArray(options.avoid_list) && options.avoid_list.length > 0 ? options.avoid_list : [];
  const emotionalSummary = String(options.emotion_summary || '').trim();
  const soundtrackSummary = String(options.soundtrack_summary || '').trim();
  const creativePrompt = promptText;
  const renderConfig = {
    images,
    productTitle,
    hook,
    script,
    caption,
    cta,
    brandName,
    subtitle,
    hashtags,
    creativePrompt,
    avoidList,
    emotionalSummary,
    soundtrackSummary,
    width: Number(options.width || 1080),
    height: Number(options.height || 1920),
    luxury: isLuxury
  };
  const configJson = JSON.stringify(renderConfig);
  const productImageMarkup = images[0]
    ? `<img class="hero-product" src="${escapeHtml(images[0])}" alt="Product preview" />`
    : '<div class="placeholder">Product preview</div>';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: dark; }
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #020617; font-family: Inter, 'Segoe UI', Arial, sans-serif; color: #f8fafc; }
      body { display: flex; align-items: center; justify-content: center; overflow: hidden; }
      .frame { position: relative; width: ${renderConfig.width}px; height: ${renderConfig.height}px; border-radius: 40px; overflow: hidden; background: linear-gradient(135deg, #111827 0%, #020617 45%, #0f172a 100%); box-shadow: 0 24px 90px rgba(0,0,0,0.34); transform: translateZ(0); isolation: isolate; }
      .frame::before { content: ''; position: absolute; inset: 0; background: linear-gradient(120deg, rgba(45,212,191,0.12), transparent 30%, rgba(249,115,22,0.16) 68%, rgba(59,130,246,0.14)); mix-blend-mode: screen; pointer-events: none; }
      .ambient { position: absolute; inset: -20%; background: radial-gradient(circle at 20% 12%, rgba(45,212,191,0.25), transparent 28%), radial-gradient(circle at 82% 16%, rgba(249,115,22,0.24), transparent 26%), radial-gradient(circle at 60% 84%, rgba(59,130,246,0.18), transparent 30%); filter: blur(12px); transform: scale(1.04); transition: transform 0.8s ease; }
      .grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px); background-size: 100px 100px; opacity: 0.16; mask-image: linear-gradient(180deg, rgba(255,255,255,0.8), transparent 85%); }
      .scene { position: absolute; inset: 0; opacity: 0; transform: translate3d(24px, 0, 0) scale(0.96); transition: opacity 0.28s ease, transform 0.28s ease; will-change: opacity, transform; }
      .scene.active { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
      .content-layer { position: absolute; left: 54px; right: 54px; top: 88px; z-index: 3; }
      .eyebrow { display: inline-flex; margin-bottom: 14px; padding: 8px 12px; border-radius: 999px; background: rgba(255,255,255,0.12); color: #bae6fd; font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.16em; }
      .emotion-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
      .emotion-pill { padding: 8px 12px; border-radius: 999px; background: rgba(248,250,252,0.12); color: rgba(248,250,252,0.96); font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; border: 1px solid rgba(255,255,255,0.14); }
      .soundtrack-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .soundtrack-pill { padding: 8px 10px; border-radius: 999px; background: rgba(34,211,238,0.16); color: #bae6fd; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; border: 1px solid rgba(34,211,238,0.24); }
      .headline { margin: 0 0 12px; font-size: 54px; font-weight: 800; line-height: 1.02; letter-spacing: -0.03em; max-width: 760px; }
      .subtext { margin: 0; font-size: 24px; color: rgba(248,250,252,0.9); line-height: 1.34; max-width: 700px; }
      .workspace-card { position: absolute; left: 54px; right: 54px; bottom: 142px; height: 56%; border-radius: 34px; background: rgba(15,23,42,0.64); backdrop-filter: blur(22px); border: 1px solid rgba(255,255,255,0.16); box-shadow: 0 24px 70px rgba(0,0,0,0.24); overflow: hidden; }
      .workspace-card::after { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(45,212,191,0.12), transparent 40%, rgba(245,158,11,0.18)); pointer-events: none; }
      .workspace-shell { position: absolute; inset: 24px; border-radius: 26px; background: linear-gradient(145deg, rgba(15,23,42,0.96), rgba(30,41,59,0.78)); border: 1px solid rgba(255,255,255,0.08); overflow: hidden; }
      .workspace-shell::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 30% 20%, rgba(255,255,255,0.08), transparent 32%), radial-gradient(circle at 70% 80%, rgba(255,255,255,0.06), transparent 28%); }
      .node { position: absolute; width: 118px; height: 118px; border-radius: 24px; background: linear-gradient(135deg, rgba(45,212,191,0.22), rgba(59,130,246,0.24)); border: 1px solid rgba(255,255,255,0.14); box-shadow: inset 0 1px 0 rgba(255,255,255,0.16); }
      .node::after { content: ''; position: absolute; inset: 16px; border-radius: 16px; background: rgba(255,255,255,0.08); }
      .node-a { left: 12%; top: 18%; }
      .node-b { right: 20%; top: 24%; }
      .node-c { left: 20%; bottom: 18%; }
      .node-d { right: 14%; bottom: 16%; }
      .node-e { left: 44%; top: 46%; width: 96px; height: 96px; }
      .wire { position: absolute; border: 2px solid rgba(125,211,252,0.46); border-radius: 999px; transform-origin: center; }
      .wire-1 { left: 18%; top: 28%; width: 26%; height: 6%; border-color: rgba(45,212,191,0.5); }
      .wire-2 { right: 24%; top: 32%; width: 18%; height: 6%; border-color: rgba(249,115,22,0.4); }
      .wire-3 { left: 30%; bottom: 26%; width: 22%; height: 6%; border-color: rgba(96,165,250,0.45); }
      .wire-4 { right: 20%; bottom: 22%; width: 18%; height: 6%; border-color: rgba(244,114,182,0.4); }
      .cursor { position: absolute; right: 15%; top: 15%; width: 24px; height: 24px; background: radial-gradient(circle, #f8fafc 0%, #93c5fd 35%, transparent 70%); border-radius: 50%; box-shadow: 0 0 18px rgba(147,197,253,0.6); }
      .render-card { position: absolute; inset: 54px 54px 120px 54px; border-radius: 34px; background: linear-gradient(135deg, rgba(6,78,59,0.6), rgba(30,41,59,0.72)); border: 1px solid rgba(255,255,255,0.14); box-shadow: 0 24px 80px rgba(0,0,0,0.3); overflow: hidden; display: flex; align-items: center; justify-content: center; }
      .render-surface { position: relative; width: 72%; height: 72%; border-radius: 28px; background: radial-gradient(circle at 30% 20%, rgba(255,255,255,0.18), transparent 24%), linear-gradient(135deg, rgba(255,255,255,0.12), rgba(15,23,42,0.7)); border: 1px solid rgba(255,255,255,0.16); box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), 0 18px 50px rgba(0,0,0,0.28); transform: scale(0.95); transition: transform 0.35s ease; filter: saturate(1.02) contrast(1.02) brightness(1.0); }
      .render-surface::after { content: ''; position: absolute; inset: 18px; border-radius: 22px; background: linear-gradient(135deg, rgba(125,211,252,0.16), rgba(244,114,182,0.14)); }
      .hero-card { position: absolute; left: 54px; right: 54px; bottom: 96px; padding: 28px; border-radius: 30px; background: rgba(15,23,42,0.78); border: 1px solid rgba(255,255,255,0.16); backdrop-filter: blur(24px); box-shadow: 0 22px 70px rgba(0,0,0,0.24); }
      .hero-card .cta-button { display: inline-block; margin-top: 16px; padding: 13px 22px; border-radius: 999px; background: linear-gradient(135deg, #f59e0b, #ec4899); color: white; font-weight: 800; letter-spacing: 0.04em; }
      .hero-product { width: 100%; height: 100%; object-fit: contain; border-radius: 24px; display: block; background: rgba(2,6,23,0.28); image-rendering: auto; }
      .placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.8); font-size: 24px; border: 2px dashed rgba(255,255,255,0.25); border-radius: 24px; }
      .guardrail { position: absolute; top: 24px; right: 24px; z-index: 5; padding: 9px 12px; border-radius: 999px; background: rgba(15,23,42,0.66); color: rgba(248,250,252,0.9); font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; border: 1px solid rgba(255,255,255,0.12); }
      .watermark { position: absolute; right: 28px; bottom: 28px; padding: 10px 14px; border-radius: 999px; background: rgba(255,255,255,0.12); color: rgba(248,250,252,0.9); font-size: 15px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
      .credit { position: absolute; left: 54px; bottom: 34px; font-size: 14px; color: rgba(226,232,240,0.74); }
      .tag-row { position: absolute; left: 54px; bottom: 56px; display: flex; flex-wrap: wrap; gap: 10px; }
      .tag-row span { padding: 8px 12px; border-radius: 999px; background: rgba(255,255,255,0.11); color: rgba(248,250,252,0.94); font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="frame">
      <div class="ambient"></div>
      <div class="grid"></div>
      <div class="guardrail">Stable composition • clean UI • no distortion</div>
      <div class="scene active">
        <div class="content-layer">
          <div class="eyebrow">Cinematic commercial • 4K motion</div>
          <h1 class="headline">${escapeHtml(productTitle)}</h1>
          <p class="subtext">${escapeHtml(hook)}</p>
          ${emotionalSummary ? `<div class="emotion-row">${emotionalSummary.split(' • ').map((token) => `<span class="emotion-pill">${escapeHtml(token)}</span>`).join('')}</div>` : ''}
          ${soundtrackSummary ? `<div class="soundtrack-row">${soundtrackSummary.split(' • ').map((token) => `<span class="soundtrack-pill">${escapeHtml(token)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="workspace-card">
          <div class="workspace-shell">
            <div class="node node-a"></div>
            <div class="node node-b"></div>
            <div class="node node-c"></div>
            <div class="node node-d"></div>
            <div class="node node-e"></div>
            <div class="wire wire-1"></div>
            <div class="wire wire-2"></div>
            <div class="wire wire-3"></div>
            <div class="wire wire-4"></div>
            <div class="cursor"></div>
          </div>
        </div>
      </div>
      <div class="scene">
        <div class="content-layer">
          <div class="eyebrow">Process</div>
          <h1 class="headline">Fluid automation in motion</h1>
          <p class="subtext">${escapeHtml(script)}</p>
        </div>
        <div class="workspace-card">
          <div class="workspace-shell">
            <div class="node node-a"></div>
            <div class="node node-b"></div>
            <div class="node node-c"></div>
            <div class="node node-d"></div>
            <div class="node node-e"></div>
            <div class="wire wire-1"></div>
            <div class="wire wire-2"></div>
            <div class="wire wire-3"></div>
            <div class="wire wire-4"></div>
            <div class="cursor"></div>
          </div>
        </div>
      </div>
      <div class="scene">
        <div class="content-layer">
          <div class="eyebrow">Transformation</div>
          <h1 class="headline">Real-time rendering with premium depth</h1>
          <p class="subtext">${escapeHtml(caption)}</p>
        </div>
        <div class="render-card">
          <div class="render-surface">${productImageMarkup}</div>
        </div>
      </div>
      <div class="scene">
        <div class="content-layer">
          <div class="eyebrow">Call to action</div>
          <h1 class="headline">${escapeHtml(brandName)}</h1>
          <p class="subtext">${escapeHtml(subtitle)}</p>
          <div class="cta-button">${escapeHtml(cta)}</div>
        </div>
        <div class="hero-card">
          <div class="render-surface">${productImageMarkup}</div>
        </div>
      </div>
      <div class="tag-row">${hashtags.split(/\s+/).filter(Boolean).slice(0, 5).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
      <div class="credit">${escapeHtml(creativePrompt ? 'Prompt-driven cinematic scene' : 'Commercial-grade motion design')}</div>
      <div class="watermark">${escapeHtml(brandName)}</div>
    </div>
    <script>
      window.renderConfig = ${configJson};
      window.preloadImages = function() {
        return Promise.all(window.renderConfig.images.filter(Boolean).map((src) => {
          return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = src;
          });
        }));
      };
      window.easeInOut = function(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      };
      window.readyPromise = window.preloadImages();

      window.updateFrame = function(frameIndex, progress) {
        const sceneCount = 4;
        const sceneIndex = Math.min(sceneCount - 1, Math.floor(progress * sceneCount));
        const sceneProgress = sceneCount > 1 ? (progress * sceneCount) % 1 : 0;
        const eased = window.easeInOut ? window.easeInOut(sceneProgress) : sceneProgress;
        const scenes = Array.from(document.querySelectorAll('.scene'));
        scenes.forEach((scene, index) => {
          const active = index === sceneIndex;
          scene.classList.toggle('active', active);
          scene.style.opacity = active ? '1' : (index === sceneIndex - 1 || index === sceneIndex + 1 ? '0.38' : '0.08');
          scene.style.transform = active
            ? 'translate3d(0, 0, 0) scale(1)'
            : 'translate3d(' + (index < sceneIndex ? -32 : 32) + 'px, 0, 0) scale(0.96)';
        });

        const ambient = document.querySelector('.ambient');
        if (ambient) {
          ambient.style.transform = 'translate3d(' + ((progress - 0.5) * 24) + 'px, ' + (Math.sin(progress * Math.PI * 2) * 8) + 'px, 0) scale(1.04)';
        }

        const nodes = Array.from(document.querySelectorAll('.node'));
        nodes.forEach((node, index) => {
          const drift = Math.sin((progress * Math.PI * 2) + index * 0.7) * 2.5;
          node.style.transform = 'translate3d(0, ' + drift + 'px, 0)';
        });

        const wires = Array.from(document.querySelectorAll('.wire'));
        wires.forEach((wire, index) => {
          wire.style.opacity = String(0.62 + 0.08 * Math.sin(progress * Math.PI * 2 + index));
          wire.style.transform = 'scaleX(' + (0.96 + 0.03 * eased) + ')';
        });

        const cursor = document.querySelector('.cursor');
        if (cursor) {
          cursor.style.transform = 'translate3d(' + (progress * 8) + 'px, ' + (4 * Math.sin(progress * Math.PI * 2)) + 'px, 0)';
        }

        const renderSurface = document.querySelector('.render-surface');
        if (renderSurface) {
          renderSurface.style.transform = 'scale(' + (0.95 + 0.03 * eased) + ')';
        }

        const heroCard = document.querySelector('.hero-card');
        if (heroCard) {
          heroCard.style.opacity = String(0.8 + 0.2 * eased);
          heroCard.style.transform = sceneIndex === 3 ? 'translate3d(0, ' + (6 * Math.sin(progress * Math.PI * 2)) + 'px, 0) scale(' + (1 + 0.02 * eased) + ')' : 'translate3d(0, 0, 0) scale(1)';
        }

        const contentLayer = document.querySelector('.content-layer');
        if (contentLayer) {
          contentLayer.style.transform = sceneIndex === 3 ? 'translate3d(0, ' + (4 * Math.sin(progress * Math.PI * 2)) + 'px, 0)' : 'translate3d(0, 0, 0)';
        }
      };
      window.updateFrame(0, 0);
    </script>
  </body>
</html>`;
}

function buildFrameFileName(index) {
  return `frame-${String(index).padStart(6, '0')}.png`;
}

async function renderFramesWithPuppeteer(validated, tempDirectory, page, browser, options = {}) {
  const totalFrames = Math.max(1, Math.round(validated.duration * validated.fps));
  const framePaths = [];
  logRenderEvent('frame rendering started', { totalFrames });

  for (let index = 0; index < totalFrames; index += 1) {
    if (index % 10 === 0 || index === totalFrames - 1) {
      logRenderEvent('frame progress', { frame: index + 1, totalFrames });
    }
    const progress = totalFrames > 1 ? index / (totalFrames - 1) : 0;
    await page.evaluate((frameIndex, progressValue) => {
      if (typeof window.updateFrame === 'function') {
        window.updateFrame(frameIndex, progressValue);
      }
    }, index, progress);
    await new Promise((resolve) => setTimeout(resolve, 8));
    const framePath = path.join(tempDirectory, buildFrameFileName(index));
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    await fs.writeFile(framePath, screenshot);
    framePaths.push(framePath);
  }

  return framePaths;
}

function renderAudioTrack(validated, tempDirectory, durationSeconds) {
  return new Promise(async (resolve, reject) => {
    try {
      const hasVoiceover = Boolean(validated.voiceover_enabled && validated.voiceover_audio_url);
      const hasMusic = Boolean(validated.background_music_url);
      if (!hasVoiceover && !hasMusic) {
        resolve('');
        return;
      }

      const audioInputs = [];
      if (hasVoiceover) {
        const voiceoverPath = path.join(tempDirectory, 'voiceover.mp3');
        const response = await fetch(validated.voiceover_audio_url);
        if (!response.ok) throw new Error(`Voiceover download failed with status ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(voiceoverPath, buffer);
        audioInputs.push({ path: voiceoverPath, volume: Number(validated.voiceover_volume || 1.0) });
      }
      if (hasMusic) {
        const musicPath = path.join(tempDirectory, 'music.mp3');
        const response = await fetch(validated.background_music_url);
        if (!response.ok) throw new Error(`Background music download failed with status ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(musicPath, buffer);
        audioInputs.push({ path: musicPath, volume: Number(validated.background_music_volume || 0.12) });
      }

      const outputAudioPath = path.join(tempDirectory, 'audio.m4a');
      const audioFilters = [];
      const command = ffmpeg();
      audioInputs.forEach((input, index) => {
        command.input(input.path);
        audioFilters.push(`[${index}:a]volume=${input.volume}[a${index}]`);
      });
      const mixInputs = audioInputs.map((_, index) => `[a${index}]`).join('');
      const filterComplex = audioFilters.concat([`${mixInputs}amix=inputs=${audioInputs.length}:duration=shortest[aout]`]).join(';');
      command
        .complexFilter(filterComplex)
        .outputOptions(['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-t', String(durationSeconds)])
        .output(outputAudioPath)
        .on('stderr', (line) => logRenderEvent('ffmpeg stderr', line))
        .on('end', () => resolve(outputAudioPath))
        .on('error', reject)
        .run();
    } catch (error) {
      reject(error);
    }
  });
}

async function renderVideoToMp4(payload, outputPath, options = {}) {
  if (!resolvedFfmpegPath) {
    throw new Error('ffmpeg-static is not available in this environment.');
  }

  const validated = validateVideoRenderPayload(payload);
  logRenderEvent('payload validated', validated);
  logRenderEvent('starting Puppeteer');
  const renderStartMs = Date.now();
  const maxRenderMs = validated.test_mode ? 90_000 : (options.timeoutMs || 240_000);
  const browser = await launchBrowser({ protocolTimeout: maxRenderMs });
  let page;
  let tempDirectory;
  let ffmpegProcess;
  let tempFramesDirectory;
  let tempAudioPath = '';
  let timeoutHandle;

  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pinterest-video-'));
    tempFramesDirectory = path.join(tempDirectory, 'frames');
    await fs.mkdir(tempFramesDirectory, { recursive: true });

    page = await browser.newPage();
    await page.setViewport({ width: validated.width, height: validated.height, deviceScaleFactor: 1 });
    await page.setDefaultNavigationTimeout(maxRenderMs);
    await page.setDefaultTimeout(maxRenderMs);

    const html = buildVideoHtml(validated);
    logRenderEvent('page loaded', { width: validated.width, height: validated.height });
    await page.setContent(html, { waitUntil: 'load', timeout: maxRenderMs });
    await page.evaluate(() => window.readyPromise);
    logRenderEvent('image downloaded');

    const frameStartMs = Date.now();
    const renderPromise = (async () => {
      const framePaths = await renderFramesWithPuppeteer(validated, tempFramesDirectory, page, browser, { timeoutMs: maxRenderMs });
      const frameRenderTimeMs = Date.now() - frameStartMs;
      logRenderEvent('frames rendered', { totalFrames: framePaths.length, frameRenderTimeMs });

      const videoTempPath = path.join(tempDirectory, 'scene-video.mp4');
      logRenderEvent('FFmpeg started', { outputPath, duration: validated.duration, fps: validated.fps, frameCount: framePaths.length });
      await new Promise((resolve, reject) => {
        ffmpegProcess = ffmpeg()
          .input(path.join(tempFramesDirectory, 'frame-%06d.png'))
          .inputOptions(['-framerate', String(validated.fps)])
          .videoCodec('libx264')
          .outputOptions([
            '-pix_fmt', 'yuv420p',
            '-preset', 'medium',
            '-crf', '20',
            '-movflags', '+faststart',
            '-t', String(validated.duration)
          ])
          .output(videoTempPath)
          .on('stderr', (line) => logRenderEvent('ffmpeg stderr', line))
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
      logRenderEvent('FFmpeg completed', { videoTempPath });

      const hasVoiceoverOrMusic = Boolean(validated.voiceover_enabled && validated.voiceover_audio_url) || Boolean(validated.background_music_url);
      if (hasVoiceoverOrMusic) {
        tempAudioPath = await renderAudioTrack(validated, tempDirectory, validated.duration);
      }

      if (tempAudioPath) {
        await new Promise((resolve, reject) => {
          ffmpegProcess = ffmpeg()
            .input(videoTempPath)
            .input(tempAudioPath)
            .outputOptions(['-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', '-t', String(validated.duration)])
            .output(outputPath)
            .on('stderr', (line) => logRenderEvent('ffmpeg stderr', line))
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
      } else {
        await fs.copyFile(videoTempPath, outputPath);
      }

      const size = (await fs.stat(outputPath)).size;
      const totalRenderTimeMs = Date.now() - renderStartMs;
      logRenderEvent('output completed', { outputPath, size, totalRenderTimeMs });
      return { outputPath, validated, size, totalRenderTimeMs, frameRenderTimeMs };
    })();

    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        const error = new Error('Test render exceeded 90 seconds and was aborted.');
        error.code = 'RENDER_TIMEOUT';
        reject(error);
      }, maxRenderMs);
    });

    const result = await Promise.race([renderPromise, timeoutPromise]);
    clearTimeout(timeoutHandle);
    return result;
  } catch (error) {
    logRenderEvent('full caught error stack', { error: error && error.stack ? error.stack : String(error) });
    if (ffmpegProcess && typeof ffmpegProcess.kill === 'function') {
      ffmpegProcess.kill('SIGKILL');
    }
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (page) {
      await page.close().catch((error) => console.warn(`Video page cleanup failed: ${error.message}`));
    }
    if (browser) {
      await browser.close().catch((error) => console.warn(`Video browser cleanup failed: ${error.message}`));
    }
    if (ffmpegProcess && typeof ffmpegProcess.kill === 'function') {
      ffmpegProcess.kill('SIGKILL');
    }
    if (tempDirectory) {
      await fs.rm(tempDirectory, { recursive: true, force: true }).catch((error) => {
        console.warn(`Temporary video directory cleanup failed: ${error.message}`);
      });
    }
  }
}

module.exports = {
  VideoRenderValidationError,
  validateVideoRenderPayload,
  renderVideoToMp4
};
