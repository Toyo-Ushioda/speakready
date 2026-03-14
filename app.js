/* ============================================================
   PRONUNCIATION PRACTICE APP — Main Logic
   Sections:
     A. Initialization & DOM References
     B. Screen Navigation
     C. Speech Recognition
     D. Text Comparison & Scoring
     E. Results Rendering
     F. Practice History (localStorage)
     G. Quick Phrases
     H. PWA Install Prompt
   ============================================================ */
'use strict';

/* ============================================================
   A. INITIALIZATION & DOM REFERENCES
   ============================================================ */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// Screens
const registerScreen = document.getElementById('register-screen');
const welcomeScreen = document.getElementById('welcome-screen');
const practiceScreen = document.getElementById('practice-screen');

// Registration elements
const registerEmail = document.getElementById('register-email');
const registerBtn = document.getElementById('register-btn');
const registerError = document.getElementById('register-error');

// Welcome screen elements
const sentenceInput = document.getElementById('sentence-input');
const startBtn = document.getElementById('start-btn');
const phrasesContainer = document.getElementById('phrases-container');
const historySection = document.getElementById('history-section');
const historyList = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const clearInputBtn = document.getElementById('clear-input-btn');

// Practice screen elements
const backBtn = document.getElementById('back-btn');
const targetSentence = document.getElementById('target-sentence');
const recordBtn = document.getElementById('record-btn');
const recordStatus = document.getElementById('record-status');
const interimText = document.getElementById('interim-text');
const resultsSection = document.getElementById('results-section');
const wordResults = document.getElementById('word-results');
const spokenText = document.getElementById('spoken-text');
const scoreCircle = document.getElementById('score-circle');
const scoreValue = document.getElementById('score-value');
const scoreMessage = document.getElementById('score-message');
const retryBtn = document.getElementById('retry-btn');
const newSentenceBtn = document.getElementById('new-sentence-btn');

// Compatibility warning
const compatWarning = document.getElementById('compat-warning');
const compatDismiss = document.getElementById('compat-dismiss');

// Install banner
const installBanner = document.getElementById('install-banner');
const installBtn = document.getElementById('install-btn');
const installDismiss = document.getElementById('install-dismiss');

// State
let recognition = null;
let isRecording = false;
let currentSentence = '';
let deferredInstallPrompt = null;
let lastTranscript = '';
let lastConfidence = 0;
let lastAlternatives = [];  // All alternative transcriptions for stricter scoring
let resultProcessed = false;
let userStoppedRecording = false;  // true only when user clicks stop button
let accumulatedTranscript = '';    // Text accumulated across auto-restarts
let accumulatedAlternatives = [];  // Alternatives accumulated across auto-restarts

// Audio visualizer state
let audioContext = null;
let analyser = null;
let micStream = null;
let animationId = null;

// Constants
const HISTORY_KEY = 'pronunciation-history';
const MAX_HISTORY = 20;
const REGISTERED_KEY = 'speakready-registered';
const GFORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSey-xtrbBzVTxxQBNiq9mV7O3-GP2SzfE9Q1e5rU7ziMeuXcA/formResponse';
const GFORM_EMAIL_FIELD = 'entry.811181247';

document.addEventListener('DOMContentLoaded', () => {
  // Check if user is already registered
  if (!localStorage.getItem(REGISTERED_KEY)) {
    registerScreen.classList.remove('hidden');
    registerScreen.classList.add('active');
    welcomeScreen.classList.add('hidden');
    welcomeScreen.classList.remove('active');
  }
  // Check browser compatibility
  if (!SpeechRecognition) {
    compatWarning.classList.remove('hidden');
    recordBtn.disabled = true;
  }

  // Render quick phrases with tabs
  renderPhraseTabs();
  renderPhrases();

  // Render history
  renderHistory();

  // Event listeners
  startBtn.addEventListener('click', handleStart);
  backBtn.addEventListener('click', () => showScreen('welcome'));
  recordBtn.addEventListener('click', toggleRecording);
  retryBtn.addEventListener('click', handleRetry);
  newSentenceBtn.addEventListener('click', () => showScreen('welcome'));
  clearHistoryBtn.addEventListener('click', handleClearHistory);
  compatDismiss.addEventListener('click', () => compatWarning.classList.add('hidden'));

  // Clear input button — show/hide based on textarea content
  const toggleClearBtn = () => {
    clearInputBtn.classList.toggle('hidden', !sentenceInput.value.trim());
  };
  sentenceInput.addEventListener('input', toggleClearBtn);
  clearInputBtn.addEventListener('click', () => {
    sentenceInput.value = '';
    clearInputBtn.classList.add('hidden');
    sentenceInput.focus();
  });

  // Allow Enter key in textarea to start (Shift+Enter for newline)
  sentenceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleStart();
    }
  });

  // Registration form
  registerBtn.addEventListener('click', handleRegister);
  registerEmail.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRegister();
    }
  });

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
});


/* ============================================================
   B. SCREEN NAVIGATION
   ============================================================ */

function showScreen(screen) {
  // Hide all screens first
  registerScreen.classList.add('hidden');
  registerScreen.classList.remove('active');
  welcomeScreen.classList.add('hidden');
  welcomeScreen.classList.remove('active');
  practiceScreen.classList.add('hidden');
  practiceScreen.classList.remove('active');

  if (screen === 'welcome') {
    stopRecognition();
    welcomeScreen.classList.remove('hidden');
    welcomeScreen.classList.add('active');
    renderHistory();
  } else if (screen === 'practice') {
    practiceScreen.classList.remove('hidden');
    practiceScreen.classList.add('active');
    clearResults();
  }
}

function handleRegister() {
  const email = registerEmail.value.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email || !emailRegex.test(email)) {
    registerEmail.classList.add('error');
    registerError.classList.remove('hidden');
    return;
  }

  registerEmail.classList.remove('error');
  registerError.classList.add('hidden');
  registerBtn.disabled = true;
  registerBtn.textContent = '登録中...';

  // Submit to Google Forms silently
  const formData = new URLSearchParams();
  formData.append(GFORM_EMAIL_FIELD, email);

  fetch(GFORM_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString()
  }).then(() => {
    // no-cors means we can't read the response, but submission works
    localStorage.setItem(REGISTERED_KEY, email);
    trackEvent('user_registered', { method: 'email' });
    showScreen('welcome');
  }).catch(() => {
    // Even on network error, let user proceed (save locally)
    localStorage.setItem(REGISTERED_KEY, email);
    showScreen('welcome');
  });
}

function handleStart() {
  const text = sentenceInput.value.trim();
  if (!text) {
    sentenceInput.focus();
    sentenceInput.style.borderColor = 'var(--color-wrong)';
    setTimeout(() => sentenceInput.style.borderColor = '', 1500);
    return;
  }
  currentSentence = text;
  targetSentence.textContent = text;
  showScreen('practice');
  trackEvent('practice_started', { word_count: text.split(/\s+/).length });
}


/* ============================================================
   C. SPEECH RECOGNITION
   ============================================================ */

function toggleRecording() {
  if (isRecording) {
    stopRecognition();
  } else {
    startRecognition();
  }
}

function startRecognition() {
  if (!SpeechRecognition) return;

  // Reset accumulated state for fresh recording
  accumulatedTranscript = '';
  accumulatedAlternatives = [];

  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 5;

  recognition.onstart = () => {
    isRecording = true;
    // Only reset state on fresh start, not auto-restart
    if (!accumulatedTranscript) {
      userStoppedRecording = false;
      lastTranscript = '';
      lastConfidence = 0;
      lastAlternatives = [];
      resultProcessed = false;
      recordBtn.classList.add('recording');
      recordStatus.textContent = '話してください... 終わったらボタンを押してください';
      interimText.textContent = '';
      clearResults();
    }
  };

  recognition.onresult = (event) => {
    let sessionTranscript = '';
    let latestConfidence = 0;
    const alternatives = [];

    for (let i = 0; i < event.results.length; i++) {
      const topResult = event.results[i][0];
      sessionTranscript += topResult.transcript;
      latestConfidence = topResult.confidence || latestConfidence;

      if (event.results[i].isFinal) {
        const alts = [];
        for (let a = 0; a < event.results[i].length; a++) {
          alts.push({
            transcript: event.results[i][a].transcript,
            confidence: event.results[i][a].confidence
          });
        }
        alternatives.push(alts);
      }
    }

    // Combine accumulated text from previous auto-restarts with current session
    lastTranscript = accumulatedTranscript + sessionTranscript;
    lastConfidence = latestConfidence || lastConfidence;
    if (alternatives.length > 0) {
      lastAlternatives = [...accumulatedAlternatives, ...alternatives];
    }

    interimText.textContent = lastTranscript;
  };

  recognition.onerror = (event) => {
    isRecording = false;
    recordBtn.classList.remove('recording');

    switch (event.error) {
      case 'no-speech':
        recordStatus.textContent = '音声が認識されませんでした。もう一度お試しください';
        break;
      case 'audio-capture':
        recordStatus.textContent = 'マイクが見つかりません。マイクを接続してください';
        break;
      case 'not-allowed':
        recordStatus.textContent = 'マイクの使用が許可されていません。ブラウザの設定を確認してください';
        break;
      default:
        recordStatus.textContent = 'エラーが発生しました。もう一度お試しください';
    }
  };

  recognition.onend = () => {
    // If the user didn't click stop, auto-restart (Chrome kills recognition on silence)
    if (!userStoppedRecording && !resultProcessed) {
      // Save current transcript before restart so it's not lost
      accumulatedTranscript = lastTranscript;
      accumulatedAlternatives = lastAlternatives.slice();
      try {
        recognition.start();
        return;  // Stay in recording state, don't process results yet
      } catch (e) {
        // If restart fails, fall through to process what we have
      }
    }

    isRecording = false;
    recordBtn.classList.remove('recording');
    stopAudioVisualizer();

    if (!resultProcessed && lastTranscript) {
      interimText.textContent = '';
      resultProcessed = true;
      processResult(lastTranscript, lastConfidence);
    } else if (!resultProcessed) {
      recordStatus.textContent = '音声が認識されませんでした。もう一度お試しください';
    }

    // Reset accumulated state for next recording
    accumulatedTranscript = '';
    accumulatedAlternatives = [];
  };

  try {
    recognition.start();
    startAudioVisualizer();
  } catch (e) {
    recordStatus.textContent = 'マイクを起動できませんでした。ページを再読み込みしてください';
  }
}

function stopRecognition() {
  userStoppedRecording = true;  // Prevent auto-restart in onend
  if (recognition && isRecording) {
    recognition.stop();
  }
  isRecording = false;
  recordBtn.classList.remove('recording');
  stopAudioVisualizer();
}

/* --- Audio Visualizer --- */

async function startAudioVisualizer() {
  const canvas = document.getElementById('audio-visualizer');
  canvas.classList.remove('hidden');

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;

    const source = audioContext.createMediaStreamSource(micStream);
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const ctx = canvas.getContext('2d');
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;
    const barCount = 32;
    const barWidth = (WIDTH / barCount) - 2;

    function draw() {
      animationId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.fillStyle = '#eef2ff';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      const step = Math.floor(bufferLength / barCount);
      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step];
        const barHeight = (value / 255) * HEIGHT * 0.9;
        const x = i * (barWidth + 2) + 1;
        const y = HEIGHT - barHeight;

        // Color: green if loud enough, primary if quiet
        if (value > 80) {
          ctx.fillStyle = '#22c55e';
        } else if (value > 30) {
          ctx.fillStyle = '#4f46e5';
        } else {
          ctx.fillStyle = '#c7d2fe';
        }

        // Rounded bar tops
        const radius = Math.min(barWidth / 2, 3);
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + barWidth - radius, y);
        ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
        ctx.lineTo(x + barWidth, HEIGHT);
        ctx.lineTo(x, HEIGHT);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.fill();
      }
    }

    draw();
  } catch (e) {
    // If getUserMedia fails, just hide the visualizer — speech recognition may still work
    canvas.classList.add('hidden');
  }
}

function stopAudioVisualizer() {
  const canvas = document.getElementById('audio-visualizer');
  canvas.classList.add('hidden');

  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
}

function processResult(transcript, confidence) {
  const comparison = compareTexts(currentSentence, transcript, confidence || 0, lastAlternatives);
  renderResults(comparison, transcript);
  saveToHistory(currentSentence, comparison.score);
  trackEvent('practice_completed', {
    score: comparison.score,
    word_count: comparison.totalWords
  });
}


/* ============================================================
   D. TEXT COMPARISON & SCORING
   ============================================================ */

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u2032\u0060]/g, "'")  // Smart quotes → straight apostrophe
    .replace(/[\u201C\u201D]/g, '')                 // Remove smart double quotes
    .replace(/[^\w\s'\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Strip all non-alpha for loose comparison (e.g., "brightwave" === "brightwave")
function stripToAlpha(word) {
  return word.replace(/[^a-z]/g, '');
}

// Common contractions → expanded forms
const CONTRACTIONS = {
  "i'm": ["i", "am"], "i've": ["i", "have"], "i'll": ["i", "will"], "i'd": ["i", "would"],
  "you're": ["you", "are"], "you've": ["you", "have"], "you'll": ["you", "will"],
  "he's": ["he", "is"], "she's": ["she", "is"], "it's": ["it", "is"],
  "we're": ["we", "are"], "we've": ["we", "have"], "we'll": ["we", "will"],
  "they're": ["they", "are"], "they've": ["they", "have"], "they'll": ["they", "will"],
  "that's": ["that", "is"], "there's": ["there", "is"], "here's": ["here", "is"],
  "what's": ["what", "is"], "who's": ["who", "is"], "how's": ["how", "is"],
  "don't": ["do", "not"], "doesn't": ["does", "not"], "didn't": ["did", "not"],
  "isn't": ["is", "not"], "aren't": ["are", "not"], "wasn't": ["was", "not"],
  "weren't": ["were", "not"], "won't": ["will", "not"], "wouldn't": ["would", "not"],
  "couldn't": ["could", "not"], "shouldn't": ["should", "not"],
  "can't": ["can", "not"], "haven't": ["have", "not"], "hasn't": ["has", "not"],
  "let's": ["let", "us"]
};

function compareTexts(target, spoken, confidence, alternatives) {
  const targetWords = normalize(target).split(' ').filter(w => w);
  const spokenWords = normalize(spoken).split(' ').filter(w => w);

  // Build a flat set of all spoken words (alpha-only) for quick lookup
  const spokenAlphaSet = new Set(spokenWords.map(stripToAlpha));

  // Build alternative word sets
  const altWordSets = [];
  if (alternatives && alternatives.length > 0) {
    for (const chunk of alternatives) {
      for (let a = 1; a < chunk.length; a++) {
        const words = normalize(chunk[a].transcript).split(' ').filter(w => w);
        altWordSets.push(new Set(words.map(stripToAlpha)));
      }
    }
  }

  const spokenMatched = new Array(spokenWords.length).fill(false);
  const results = [];
  let spokenIdx = 0;
  let weightedScore = 0;

  for (let i = 0; i < targetWords.length; i++) {
    const tw = targetWords[i];
    const twAlpha = stripToAlpha(tw);
    let found = false;
    let matchedCount = 0;  // How many spoken words were consumed

    // Strategy 1: Direct match (exact word)
    for (let j = spokenIdx; j < spokenWords.length; j++) {
      if (stripToAlpha(spokenWords[j]) === twAlpha) {
        found = true;
        spokenMatched[j] = true;
        spokenIdx = j + 1;
        matchedCount = 1;
        break;
      }
    }

    // Strategy 2: Compound word — target "brightwave" matches spoken "bright" + "wave"
    // Try joining 2-3 consecutive spoken words
    if (!found) {
      for (let j = spokenIdx; j < spokenWords.length; j++) {
        let combined = '';
        for (let k = j; k < Math.min(j + 3, spokenWords.length); k++) {
          combined += stripToAlpha(spokenWords[k]);
          if (combined === twAlpha) {
            found = true;
            for (let m = j; m <= k; m++) spokenMatched[m] = true;
            spokenIdx = k + 1;
            matchedCount = k - j + 1;
            break;
          }
        }
        if (found) break;
      }
    }

    // Strategy 3: Contraction match — target "I'm" matches spoken "I am"
    if (!found && CONTRACTIONS[tw]) {
      const expanded = CONTRACTIONS[tw];
      for (let j = spokenIdx; j < spokenWords.length; j++) {
        if (stripToAlpha(spokenWords[j]) === expanded[0] &&
            j + 1 < spokenWords.length &&
            stripToAlpha(spokenWords[j + 1]) === expanded[1]) {
          found = true;
          spokenMatched[j] = true;
          spokenMatched[j + 1] = true;
          spokenIdx = j + 2;
          matchedCount = 2;
          break;
        }
      }
    }

    // Strategy 4: Reverse contraction — target "I am" matches spoken "I'm"
    // (target has expanded form, spoken has contraction)
    if (!found) {
      for (const [contraction, expanded] of Object.entries(CONTRACTIONS)) {
        if (expanded[0] === twAlpha && i + 1 < targetWords.length && expanded[1] === stripToAlpha(targetWords[i + 1])) {
          // Look for the contraction in spoken words
          for (let j = spokenIdx; j < spokenWords.length; j++) {
            if (stripToAlpha(spokenWords[j]) === stripToAlpha(contraction)) {
              found = true;
              spokenMatched[j] = true;
              spokenIdx = j + 1;
              matchedCount = 1;
              // Mark next target word as matched too (skip it)
              i++;
              results.push({
                word: target.split(/\s+/)[i - 1] || tw,
                correct: true,
                clarity: 1.0
              });
              weightedScore += 1.0;
              break;
            }
          }
          if (found) break;
        }
      }
    }

    // Strategy 5: Fuzzy prefix match — "design" ≈ "designed", "reserve" ≈ "reservation"
    // One word must start with the other, and the shorter must be at least 4 chars
    if (!found) {
      for (let j = spokenIdx; j < spokenWords.length; j++) {
        const sw = stripToAlpha(spokenWords[j]);
        if (sw.length >= 4 && twAlpha.length >= 4) {
          if (sw.startsWith(twAlpha) || twAlpha.startsWith(sw)) {
            found = true;
            spokenMatched[j] = true;
            spokenIdx = j + 1;
            matchedCount = 1;
            break;
          }
        }
      }
    }

    // Check alternative-based confidence penalty
    let wordConfidence = 1.0;
    if (found && altWordSets.length > 0) {
      let missingCount = 0;
      for (const altSet of altWordSets) {
        if (!altSet.has(twAlpha)) missingCount++;
      }
      const missingRatio = missingCount / altWordSets.length;
      if (missingRatio > 0.5) {
        wordConfidence = 0.3 + (1 - missingRatio) * 0.4;
      }
    }

    // For wrong words, find what was likely heard instead
    let heard = null;
    if (!found) {
      // Look at the next few unmatched spoken words near current position
      for (let j = Math.max(0, spokenIdx - 2); j < Math.min(spokenIdx + 3, spokenWords.length); j++) {
        if (!spokenMatched[j]) {
          heard = spokenWords[j];
          break;
        }
      }
    }

    results.push({
      word: target.split(/\s+/)[i] || tw,
      correct: found,
      clarity: found ? wordConfidence : 0,
      heard: heard  // What was heard instead (null if correct)
    });

    weightedScore += found ? wordConfidence : 0;
  }

  // Find extra words that were spoken but not in the target
  const targetAlphaWords = targetWords.map(stripToAlpha);
  const targetAlphaSet = new Set(targetAlphaWords);
  const extraWords = [];
  for (let j = 0; j < spokenWords.length; j++) {
    if (spokenMatched[j]) continue;
    const sw = stripToAlpha(spokenWords[j]);
    // Skip if it's in the target set or a close prefix match to any target word
    const inTarget = targetAlphaSet.has(sw) ||
      targetAlphaWords.some(tw => sw.length >= 4 && tw.length >= 4 && (sw.startsWith(tw) || tw.startsWith(sw)));
    if (!inTarget) {
      extraWords.push(spokenWords[j]);
    }
  }

  // Word accuracy: recall weighted by clarity (0-100)
  const recallScore = targetWords.length > 0
    ? (weightedScore / targetWords.length) * 100
    : 0;

  // Precision penalty: extra words reduce the score
  // Each extra word costs 10 points (capped so it doesn't go below 0)
  const extraPenalty = Math.min(extraWords.length * 10, 50);

  // Pronunciation quality from speech recognition confidence
  const confidenceScore = (confidence > 0 ? confidence : 0.5) * 100;

  // Dynamic weighting: short sentences rely more on word accuracy,
  // long sentences rely more on confidence (API gives lower confidence for 1-2 words)
  const wordCount = targetWords.length;
  let wordWeight, confWeight;
  if (wordCount <= 2) {
    wordWeight = 0.8;
    confWeight = 0.2;
  } else if (wordCount >= 6) {
    wordWeight = 0.3;
    confWeight = 0.7;
  } else {
    // Linear interpolation: 2 words → 0.8/0.2, 6 words → 0.3/0.7
    const t = (wordCount - 2) / 4;
    wordWeight = 0.8 - t * 0.5;
    confWeight = 0.2 + t * 0.5;
  }

  const rawScore = recallScore * wordWeight + confidenceScore * confWeight - extraPenalty;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  return {
    results,
    score,
    extraWords,
    matchCount: Math.round(weightedScore * 10) / 10,
    totalWords: targetWords.length,
    confidence: Math.round(confidenceScore)
  };
}


/* ============================================================
   E. RESULTS RENDERING
   ============================================================ */

function renderResults(comparison, transcript) {
  // Word-by-word coloring with annotations for wrong/unclear words
  let html = comparison.results
    .map(r => {
      let cls = 'word-wrong';
      if (r.correct && r.clarity >= 0.8) cls = 'word-correct';
      else if (r.correct) cls = 'word-unclear';

      // For wrong words, show what was heard instead
      let annotation = '';
      if (!r.correct && r.heard) {
        annotation = `<span class="word-heard">${escapeHtml(r.heard)}</span>`;
      } else if (!r.correct) {
        annotation = `<span class="word-heard">?</span>`;
      }

      return `<span class="word-chip ${cls}">${escapeHtml(r.word)}${annotation}</span>`;
    })
    .join(' ');

  wordResults.innerHTML = html;

  // Spoken text
  spokenText.textContent = transcript;

  // Score
  const score = comparison.score;
  scoreValue.textContent = score;

  // Score circle color
  scoreCircle.className = 'score-circle';
  if (score >= 90) {
    scoreCircle.classList.add('excellent');
    scoreMessage.textContent = '素晴らしい！完璧です！';
    scoreMessage.style.color = 'var(--color-correct)';
  } else if (score >= 70) {
    scoreCircle.classList.add('good');
    scoreMessage.textContent = 'いい調子です！もう一度挑戦しましょう';
    scoreMessage.style.color = '#a16207';
  } else {
    scoreCircle.classList.add('needs-work');
    scoreMessage.textContent = 'ゆっくり、はっきり話してみましょう';
    scoreMessage.style.color = 'var(--color-wrong)';
  }

  resultsSection.classList.remove('hidden');
  recordStatus.textContent = '結果を確認してください';
}

function clearResults() {
  resultsSection.classList.add('hidden');
  wordResults.innerHTML = '';
  spokenText.textContent = '';
  scoreValue.textContent = '0';
  scoreMessage.textContent = '';
  scoreCircle.className = 'score-circle';
  interimText.textContent = '';
  recordStatus.textContent = 'マイクボタンを押して話してください';
}

function handleRetry() {
  clearResults();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}


/* ============================================================
   F. PRACTICE HISTORY (localStorage)
   ============================================================ */

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveToHistory(sentence, score) {
  const history = getHistory();

  // Don't add duplicate of the most recent entry with same sentence
  if (history.length > 0 && history[0].sentence === sentence) {
    history[0].score = score;
    history[0].date = Date.now();
  } else {
    history.unshift({ sentence, score, date: Date.now() });
  }

  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function renderHistory() {
  const history = getHistory();

  if (history.length === 0) {
    historySection.classList.add('hidden');
    return;
  }

  historySection.classList.remove('hidden');
  historyList.innerHTML = history.slice(0, 10).map((item, i) => {
    const scoreClass = item.score >= 90 ? 'good' : item.score >= 70 ? 'ok' : 'needs-work';
    return `
      <li class="history-item" data-index="${i}">
        <span class="history-sentence">${escapeHtml(item.sentence)}</span>
        <span class="history-score ${scoreClass}">${item.score}%</span>
      </li>`;
  }).join('');

  // Click to re-practice
  historyList.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.index);
      const entry = history[idx];
      if (entry) {
        sentenceInput.value = entry.sentence;
        handleStart();
      }
    });
  });
}

function handleClearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}


/* ============================================================
   G. QUICK PHRASES
   ============================================================ */

const PHRASE_CATEGORIES = {
  "あいさつ・日常": [
    "Nice to meet you.",
    "How are you doing?",
    "Could you say that again, please?",
    "I'm sorry, I didn't catch that.",
    "Thank you for your help.",
    "Have a great weekend!"
  ],
  "ビジネス": [
    "What time does the meeting start?",
    "I'll send you the report by end of day.",
    "Could we schedule a call for next week?",
    "Let me walk you through the proposal.",
    "I appreciate your feedback on this.",
    "We need to align on the timeline."
  ],
  "レストラン・買い物": [
    "I'd like to make a reservation.",
    "Can I have the check, please?",
    "Do you have this in a different size?",
    "I'll have the same thing, please.",
    "Could I get a table for two?",
    "Is this on sale?"
  ],
  "Rの発音 練習": [
    "The restaurant review was really remarkable.",
    "I'd rather read the report before the presentation.",
    "Are you ready for the regular meeting on Friday?",
    "The room reservation is already arranged.",
    "Our representative will arrive around three.",
    "Right now, the interest rate is relatively low.",
    "The railroad runs right through the rural area.",
    "I really appreciate your rapid response.",
    "Remember to bring the reference materials to the room.",
    "The research results were released last Friday."
  ],
  "旅行・交通": [
    "How do I get to the station?",
    "Could you tell me where the nearest ATM is?",
    "I'd like a round-trip ticket to London.",
    "What time is the next departure?",
    "Is this seat taken?",
    "Where can I find the baggage claim?"
  ]
};

const phraseTabsContainer = document.getElementById('phrase-tabs');
let activeCategory = Object.keys(PHRASE_CATEGORIES)[0];

function renderPhraseTabs() {
  phraseTabsContainer.innerHTML = Object.keys(PHRASE_CATEGORIES)
    .map(cat => `<button class="phrase-tab ${cat === activeCategory ? 'active' : ''}">${escapeHtml(cat)}</button>`)
    .join('');

  phraseTabsContainer.querySelectorAll('.phrase-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeCategory = tab.textContent;
      renderPhraseTabs();
      renderPhrases();
    });
  });
}

function renderPhrases() {
  const phrases = PHRASE_CATEGORIES[activeCategory] || [];
  phrasesContainer.innerHTML = phrases
    .map(phrase => `<button class="phrase-chip">${escapeHtml(phrase)}</button>`)
    .join('');

  phrasesContainer.querySelectorAll('.phrase-chip').forEach((chip, i) => {
    chip.addEventListener('click', () => {
      sentenceInput.value = phrases[i];
      trackEvent('phrase_selected', { category: activeCategory });
      handleStart();
    });
  });
}


/* ============================================================
   H. PWA INSTALL PROMPT
   ============================================================ */

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  installBanner.classList.remove('hidden');
});

installBtn.addEventListener('click', async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    trackEvent('install_prompt', { outcome: choice.outcome });
    deferredInstallPrompt = null;
    installBanner.classList.add('hidden');
  }
});

installDismiss.addEventListener('click', () => {
  installBanner.classList.add('hidden');
});


/* ============================================================
   I. ANALYTICS (GA4)
   ============================================================ */

function trackEvent(eventName, params) {
  if (typeof gtag === 'function') {
    gtag('event', eventName, params);
  }
}
