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
const welcomeScreen = document.getElementById('welcome-screen');
const practiceScreen = document.getElementById('practice-screen');

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
let recognitionGeneration = 0;     // Guards against stale onend/onerror callbacks

// Audio visualizer state
let audioContext = null;
let analyser = null;
let micStream = null;
let animationId = null;

// Mobile detection
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Constants
const HISTORY_KEY = 'pronunciation-history';
const MAX_HISTORY = 20;
document.addEventListener('DOMContentLoaded', () => {
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

  // Mobile mic tip — URL copy button
  const micTipCopy = document.querySelector('.mic-tip-copy');
  if (micTipCopy) {
    micTipCopy.addEventListener('click', () => {
      navigator.clipboard.writeText(window.location.href).then(() => {
        micTipCopy.textContent = 'コピーしました！';
        setTimeout(() => { micTipCopy.textContent = 'URLをコピー'; }, 2000);
      });
    });
  }

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

  // Clean up any previous recognition — don't abort, just detach handlers and null out
  if (recognition) {
    try {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    } catch (e) {}
    recognition = null;
  }

  // Always clean up previous mic/visualizer state first
  stopAudioVisualizer();

  // Increment generation so stale callbacks from aborted recognition are ignored
  recognitionGeneration++;
  const myGeneration = recognitionGeneration;

  // Reset all state for fresh recording
  accumulatedTranscript = '';
  accumulatedAlternatives = [];
  userStoppedRecording = false;
  lastTranscript = '';
  lastConfidence = 0;
  lastAlternatives = [];
  resultProcessed = false;
  isRecording = true;

  // Set visual state immediately — don't wait for onstart
  recordBtn.classList.add('recording');
  recordStatus.textContent = '話してください... 終わったらボタンを押してください';
  interimText.textContent = '';
  clearResults();

  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 5;

  recognition.onstart = () => {
    if (myGeneration !== recognitionGeneration) return;
  };

  recognition.onresult = (event) => {
    if (myGeneration !== recognitionGeneration) return;
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
    if (myGeneration !== recognitionGeneration) return;
    // On no-speech, don't kill the recording — let onend handle it
    if (event.error === 'no-speech') {
      return;
    }

    isRecording = false;
    recordBtn.classList.remove('recording');
    recordBtn.classList.remove('pulse-recording');
    stopAudioVisualizer();

    switch (event.error) {
      case 'audio-capture':
        recordStatus.textContent = 'マイクが見つかりません。マイクを接続してください';
        break;
      case 'not-allowed':
        recordStatus.textContent = 'マイクの使用が許可されていません';
        break;
      default:
        recordStatus.textContent = 'エラーが発生しました。もう一度お試しください';
    }
  };

  recognition.onend = () => {
    if (myGeneration !== recognitionGeneration) return;

    // Auto-restart when Chrome kills recognition on silence (not on mobile — causes mic issues)
    if (!isMobile && !userStoppedRecording && !resultProcessed) {
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
    recordBtn.classList.remove('pulse-recording');
    stopAudioVisualizer();

    if (!resultProcessed && lastTranscript) {
      interimText.textContent = '';
      resultProcessed = true;
      processResult(lastTranscript, lastConfidence);
    } else if (!resultProcessed) {
      recordStatus.textContent = '音声が認識されませんでした。もう一度お試しください';
    }

    // Clean up for next recording — null out so startRecognition doesn't try to abort a dead object
    accumulatedTranscript = '';
    accumulatedAlternatives = [];
    recognition = null;
  };

  try {
    recognition.start();
    // On mobile, use CSS pulse animation instead of getUserMedia visualizer
    // to avoid competing for mic access
    if (isMobile) {
      recordBtn.classList.add('pulse-recording');
    } else {
      startAudioVisualizer();
    }
  } catch (e) {
    isRecording = false;
    recordBtn.classList.remove('recording');
    recordBtn.classList.remove('pulse-recording');
    recordStatus.textContent = 'マイクを起動できませんでした。ChromeまたはSafariで開いてください';
  }
}

function stopRecognition() {
  userStoppedRecording = true;  // Prevent auto-restart in onend
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
  }
  isRecording = false;
  recordBtn.classList.remove('recording');
  recordBtn.classList.remove('pulse-recording');
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
    // One word must start with the other, and the shorter must be at least 5 chars
    if (!found) {
      for (let j = spokenIdx; j < spokenWords.length; j++) {
        const sw = stripToAlpha(spokenWords[j]);
        if (sw.length >= 5 && twAlpha.length >= 5) {
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

    // Check alternative-based confidence penalty (strict: triggers at 30% disagreement)
    // Skip for very short inputs (1-2 words) — alternatives are too noisy
    let wordConfidence = 1.0;
    if (found && altWordSets.length > 0 && targetWords.length > 2) {
      let missingCount = 0;
      for (const altSet of altWordSets) {
        if (!altSet.has(twAlpha)) missingCount++;
      }
      const missingRatio = missingCount / altWordSets.length;
      if (missingRatio > 0.3) {
        wordConfidence = 0.2 + (1 - missingRatio) * 0.3;
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
  const extraPenalty = Math.min(extraWords.length * 10, 40);

  // --- Determine word-level color FIRST, then derive score from colors ---
  const rawConfidence = confidence > 0 ? confidence : 0.5;
  const wordCount = targetWords.length;

  // Assign each word a color grade based on clarity + API confidence
  // For longer sentences, require higher confidence to earn green
  const confThresholdGreen = wordCount >= 6 ? 0.85 : wordCount <= 2 ? 0.6 : 0.6 + (wordCount - 2) * 0.0625;
  const confThresholdYellow = wordCount >= 6 ? 0.75 : wordCount <= 2 ? 0.4 : 0.4 + (wordCount - 2) * 0.0875;

  for (const r of results) {
    // R-containing words get stricter thresholds (hardest sound for Japanese speakers)
    const wordAlpha = r.word.toLowerCase().replace(/[^a-z]/g, '');
    const hasR = /r/.test(wordAlpha);
    const greenConf = hasR ? Math.min(confThresholdGreen + 0.08, 0.97) : confThresholdGreen;
    const yellowConf = hasR ? Math.min(confThresholdYellow + 0.08, 0.90) : confThresholdYellow;
    const clarityGreen = hasR ? 0.95 : 0.9;
    const clarityYellow = hasR ? 0.7 : 0.5;

    if (!r.correct) {
      r.color = 'red';      // 0 points
    } else if (r.clarity >= clarityGreen && rawConfidence >= greenConf) {
      r.color = 'green';    // 1.0 points
    } else if (r.clarity >= clarityYellow && rawConfidence >= yellowConf) {
      r.color = 'yellow';   // 0.5 points
    } else {
      r.color = 'orange';   // 0.25 points
    }
  }

  // Score = percentage of points earned from word colors
  const colorPoints = { green: 1.0, yellow: 0.5, orange: 0.25, red: 0 };
  const totalPoints = results.reduce((sum, r) => sum + colorPoints[r.color], 0);
  const maxPoints = results.length;
  const rawScore = maxPoints > 0 ? (totalPoints / maxPoints) * 100 - extraPenalty : 0;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  return {
    results,
    score,
    extraWords,
    matchCount: Math.round(weightedScore * 10) / 10,
    totalWords: targetWords.length,
    confidence: Math.round(rawConfidence * 100)
  };
}


/* ============================================================
   E. RESULTS RENDERING
   ============================================================ */

function renderResults(comparison, transcript) {
  // Word-by-word coloring — uses pre-assigned color from comparison
  let html = comparison.results
    .map(r => {
      const colorMap = { green: 'word-correct', yellow: 'word-unclear', orange: 'word-poor', red: 'word-wrong' };
      const cls = colorMap[r.color] || 'word-wrong';

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
  if (score >= 95) {
    scoreCircle.classList.add('excellent');
    scoreMessage.textContent = '素晴らしい！とてもクリアな発音です！';
    scoreMessage.style.color = 'var(--color-correct)';
  } else if (score >= 80) {
    scoreCircle.classList.add('good');
    scoreMessage.textContent = 'いい調子です！さらに滑らかさを意識してみましょう';
    scoreMessage.style.color = '#a16207';
  } else if (score >= 60) {
    scoreCircle.classList.add('needs-work');
    scoreMessage.textContent = 'もう一度挑戦！口の形を意識してゆっくり話しましょう';
    scoreMessage.style.color = 'var(--color-wrong)';
  } else {
    scoreCircle.classList.add('needs-work');
    scoreMessage.textContent = '一語ずつゆっくり、はっきり発音してみましょう';
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
  "Rの発音 練習 ⭐": [
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
