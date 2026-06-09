// Learn Vibe Build — deck runtime.
//
// Presentation behavior for server-rendered slide decks (src/lib/deck-render.ts).
// The page gives us a fixed 1920x1080 .deck-stage full of <section class="slide">
// elements plus a #speaker-notes JSON block; this script handles:
//   - scale-to-fit: the stage is scaled (transform) + centered in the viewport
//   - navigation: arrows / Space / PageUp/Down / Home / End / click-to-advance
//   - URL hash sync both ways (#3 -> slide 3; navigating updates the hash)
//   - a subtle mono slide counter, bottom-right
//   - 'n' toggles a speaker-notes overlay for the current slide
//   - @media print rules so printing yields all slides sequentially
//
// No dependencies, no build step. Vanilla on purpose.
(function () {
  'use strict';

  var stage = document.getElementById('deck-stage');
  if (!stage) return;
  var W = parseInt(stage.getAttribute('data-width') || '1920', 10);
  var H = parseInt(stage.getAttribute('data-height') || '1080', 10);
  var slides = Array.prototype.slice.call(stage.querySelectorAll('section.slide'));
  if (slides.length === 0) return;

  // ---------- runtime chrome styles (counter, notes overlay, print) ----------
  var style = document.createElement('style');
  style.textContent = [
    '#deck-counter {',
    '  position: fixed; right: 18px; bottom: 14px; z-index: 10;',
    "  font-family: 'JetBrains Mono', monospace; font-size: 13px;",
    '  letter-spacing: 0.06em; color: rgba(255,255,255,0.45);',
    '  user-select: none; pointer-events: none;',
    '}',
    '#deck-notes {',
    '  position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;',
    '  max-height: 45vh; overflow-y: auto; box-sizing: border-box;',
    '  background: rgba(17,17,17,0.96); color: #eaeaea;',
    '  border-top: 2px solid #e8612a; padding: 18px 28px 24px;',
    "  font-family: 'Inter', sans-serif; font-size: 16px; line-height: 1.6;",
    '}',
    '#deck-notes .label {',
    "  font-family: 'JetBrains Mono', monospace; font-size: 11px;",
    '  letter-spacing: 0.1em; text-transform: uppercase; color: #e8612a;',
    '  margin-bottom: 10px;',
    '}',
    '#deck-notes .empty { color: #888; font-style: italic; }',
    '@media print {',
    '  html, body { background: #fff; height: auto; overflow: visible; }',
    '  .deck-stage {',
    '    position: static !important; transform: none !important;',
    '    width: auto !important; height: auto !important;',
    '  }',
    '  .deck-stage section.slide {',
    '    position: relative; inset: auto; visibility: visible;',
    '    width: ' + W + 'px; height: ' + H + 'px;',
    '    page-break-after: always; break-after: page;',
    '  }',
    '  #deck-counter, #deck-notes { display: none !important; }',
    '}',
    '@page { size: ' + W + 'px ' + H + 'px; margin: 0; }',
  ].join('\n');
  document.head.appendChild(style);

  // ---------- scale-to-fit ----------
  // The stage stays a fixed WxH canvas; we scale it (origin top-left) and
  // position it so the scaled box is centered in the viewport. Doing both in
  // JS keeps the math obvious — no transform-origin/translate interplay.
  function fit() {
    var scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    stage.style.transform = 'scale(' + scale + ')';
    stage.style.left = Math.round((window.innerWidth - W * scale) / 2) + 'px';
    stage.style.top = Math.round((window.innerHeight - H * scale) / 2) + 'px';
  }
  window.addEventListener('resize', fit);
  fit();

  // ---------- speaker notes ----------
  var notes = [];
  var notesEl = document.getElementById('speaker-notes');
  if (notesEl) {
    try { notes = JSON.parse(notesEl.textContent) || []; } catch (e) { notes = []; }
  }
  var overlay = null; // created lazily on first 'n'

  function renderNotes() {
    if (!overlay) return;
    var label = slides[current].getAttribute('data-screen-label') || ('Slide ' + (current + 1));
    var text = notes[current] || '';
    overlay.innerHTML = '';
    var l = document.createElement('div');
    l.className = 'label';
    l.textContent = 'Notes — ' + label;
    overlay.appendChild(l);
    var p = document.createElement('div');
    if (text) {
      p.textContent = text;
    } else {
      p.className = 'empty';
      p.textContent = 'No notes for this slide.';
    }
    overlay.appendChild(p);
  }

  function toggleNotes() {
    if (overlay) {
      overlay.remove();
      overlay = null;
      return;
    }
    overlay = document.createElement('div');
    overlay.id = 'deck-notes';
    document.body.appendChild(overlay);
    renderNotes();
  }

  // ---------- navigation ----------
  var current = -1;
  var counter = document.createElement('div');
  counter.id = 'deck-counter';
  document.body.appendChild(counter);

  function clamp(n) {
    return Math.max(0, Math.min(slides.length - 1, n));
  }

  function show(n, updateHash) {
    n = clamp(n);
    if (n === current) return;
    if (current >= 0) slides[current].classList.remove('active');
    slides[n].classList.add('active');
    current = n;
    counter.textContent = (n + 1) + ' / ' + slides.length;
    if (overlay) renderNotes();
    if (updateHash !== false) {
      // replaceState keeps Back working like a browser button, not a rewind
      // through every slide; falls back for very old browsers.
      var hash = '#' + (n + 1);
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', hash);
      } else {
        window.location.hash = hash;
      }
    }
  }

  function next() { show(current + 1); }
  function prev() { show(current - 1); }

  // Hash -> slide (1-based; "#3" means slide 3). Invalid/missing -> slide 1.
  function slideFromHash() {
    var n = parseInt(window.location.hash.slice(1), 10);
    return isNaN(n) ? 0 : clamp(n - 1);
  }
  window.addEventListener('hashchange', function () {
    show(slideFromHash(), false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        next();
        break;
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        prev();
        break;
      case 'Home':
        e.preventDefault();
        show(0);
        break;
      case 'End':
        e.preventDefault();
        show(slides.length - 1);
        break;
      case 'n':
      case 'N':
        toggleNotes();
        break;
    }
  });

  // Click-to-advance — but let links be links and the notes overlay scroll.
  document.addEventListener('click', function (e) {
    if (e.target.closest('a') || e.target.closest('#deck-notes')) return;
    next();
  });

  show(slideFromHash(), false);
})();
