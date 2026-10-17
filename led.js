// The LED dots on these pages (the cat, the name, headings, numbers and the
// sign at the top), drawn the way the app draws them. Every word they show is
// also in the page as text, for screen readers and search engines.
//
// Loaded in <head> so the page picks its language before it first appears;
// the drawing waits for the document.
(() => {
  'use strict';

  const YELLOW = [255, 230, 0];
  const PINK = [255, 79, 163];
  const BLUSH = [255, 95, 168];
  const SKY = [50, 215, 255];
  const GREEN = [48, 240, 112];
  const RED = [255, 59, 48];

  const FILL = 0.82;   // dot diameter, as a share of the distance between dots
  const UNLIT = 0.075; // how faintly a dot that is off still shows
  const GLOW = 0.82;   // width of the glow, in distances between dots
  const BLEED = 2;     // room left around the dots for the glow, in the same unit
  const SAMPLES = 4;   // samples across each dot when text is turned into dots
  const FONT = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Segoe UI", sans-serif';

  // The app's cat, as on its icon: `#` lit, `p` cheek, `o` left dark, `.` off.
  const CAT = [
    '...............',
    '..#.........#..',
    '.###.......###.',
    '.####.....####.',
    '.#############.',
    '.#############.',
    '.###o#####o###.',
    '.###o#####o###.',
    '.#pp###o###pp#.',
    '.#####o#o#####.',
    '.#############.',
    '..###########..',
    '....#######....',
    '...............',
    '...............',
  ];

  // What the sign shows, one language at a time. `still` lights up in place,
  // `flash` shows one word after another, `scroll` runs right to left.
  const MESSAGES = {
    ko: [
      { text: '폰광판', colour: 'brand', mode: 'still' },
      { text: '오늘도 최고야', colour: SKY, mode: 'flash' },
      { text: '환영합니다', colour: GREEN, mode: 'scroll' },
      { text: '생일 축하해', colour: PINK, mode: 'scroll' },
      { text: '사랑해요', colour: RED, mode: 'scroll' },
    ],
    en: [
      { text: 'Phoneon', colour: 'brand', mode: 'still' },
      { text: 'GO TEAM GO', colour: SKY, mode: 'flash' },
      { text: 'WELCOME HOME', colour: GREEN, mode: 'scroll' },
      { text: 'HAPPY BIRTHDAY', colour: PINK, mode: 'scroll' },
      { text: 'LOVE YOU', colour: RED, mode: 'scroll' },
    ],
  };
  const SIGN_COLUMNS = 52;
  const SIGN_ROWS = 24;
  const SPEED = 20; // columns per second

  const LANGUAGES = ['ko', 'en'];
  const root = document.documentElement;
  let language = initialLanguage();
  root.lang = language;
  root.dataset.lang = language;

  /** A `?lang=` in the address wins; otherwise the first of the reader's languages the pages are in. */
  function initialLanguage() {
    const asked = new URLSearchParams(location.search).get('lang');
    if (LANGUAGES.includes(asked)) return asked;
    for (const tag of navigator.languages || [navigator.language || '']) {
      const base = String(tag).toLowerCase().split('-')[0];
      if (LANGUAGES.includes(base)) return base;
    }
    return 'en';
  }

  const ratio = () => Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const hasHangul = (text) => /[ᄀ-ᇿ㄰-㆏가-힣]/.test(text);

  // MARK: Grids of dots

  // A grid has one cell per dot: 0 off, 1 lit, 2 cheek, 3 dark (no dot at all).
  function gridFromDrawing(drawing) {
    const rows = drawing.length;
    const columns = drawing[0].length;
    const cells = new Uint8Array(rows * columns);
    const codes = { '#': 1, p: 2, o: 3 };
    drawing.forEach((line, r) => {
      [...line].forEach((ch, c) => { cells[r * columns + c] = codes[ch] || 0; });
    });
    return { columns, rows, cells };
  }

  const probe = document.createElement('canvas').getContext('2d');

  function inkOf(text, font) {
    probe.font = font;
    const m = probe.measureText(text);
    return {
      left: m.actualBoundingBoxLeft,
      right: m.actualBoundingBoxRight,
      ascent: m.actualBoundingBoxAscent,
      descent: m.actualBoundingBoxDescent,
    };
  }

  /**
   * Text turned into dots `rows` tall. The ink of `reference` counts towards the
   * height too, so that headings in one writing share a size and a baseline.
   */
  function gridFromText(text, rows, weight, reference) {
    const font = (px) => `${weight} ${px}px ${FONT}`;
    const ink = inkOf(text, font(100));
    const ref = reference ? inkOf(reference, font(100)) : ink;
    const ascent = Math.max(ink.ascent, ref.ascent);
    const descent = Math.max(ink.descent, ref.descent);
    const scale = (rows * SAMPLES) / Math.max(ascent + descent, 1);
    const width = Math.max((ink.left + ink.right) * scale, 1);
    const columns = Math.ceil(width / SAMPLES);

    const canvas = document.createElement('canvas');
    canvas.width = columns * SAMPLES;
    canvas.height = rows * SAMPLES;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.font = font(100 * scale);
    g.fillStyle = '#fff';
    g.fillText(text, ink.left * scale + (canvas.width - width) / 2, ascent * scale);
    const alpha = g.getImageData(0, 0, canvas.width, canvas.height).data;

    // A dot is lit when enough of its square is covered.
    const cells = new Uint8Array(columns * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        let sum = 0;
        for (let y = 0; y < SAMPLES; y++) {
          const start = ((r * SAMPLES + y) * canvas.width + c * SAMPLES) * 4 + 3;
          for (let x = 0; x < SAMPLES; x++) sum += alpha[start + x * 4];
        }
        cells[r * columns + c] = sum / (SAMPLES * SAMPLES * 255) > 0.42 ? 1 : 0;
      }
    }
    return { columns, rows, cells };
  }

  /** The tallest text that still fits `maxColumns` across. */
  function fittedGrid(text, rows, weight, maxColumns) {
    let grid = gridFromText(text, rows, weight);
    while (grid.columns > maxColumns && rows > 7) {
      rows -= 1;
      grid = gridFromText(text, rows, weight);
    }
    return grid;
  }

  /** The app's colours: yellow at the top of what is lit, running to pink at the bottom. */
  const brand = (t) => mix(YELLOW, PINK, t);

  /**
   * Paints a grid onto `ctx`, which draws in CSS pixels, with the top-left dot's
   * square at (x, y). Lit dots get a glow; `scale` is device pixels per CSS pixel,
   * since a canvas shadow ignores the drawing scale.
   */
  function paint(ctx, grid, pitch, x, y, colour, showsUnlit, scale) {
    const { columns, rows, cells } = grid;
    const radius = (pitch * FILL) / 2;
    let first = rows;
    let last = -1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const cell = cells[r * columns + c];
        if (cell === 1 || cell === 2) { first = Math.min(first, r); last = Math.max(last, r); }
      }
    }
    const span = Math.max(last - first, 1);
    const centre = (i) => i * pitch + pitch / 2;

    if (showsUnlit) {
      ctx.fillStyle = rgba([255, 255, 255], UNLIT);
      ctx.beginPath();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) {
          if (cells[r * columns + c] !== 0) continue;
          ctx.moveTo(x + centre(c) + radius, y + centre(r));
          ctx.arc(x + centre(c), y + centre(r), radius, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    }

    const lit = [];
    for (let r = 0; r < rows; r++) {
      const body = rgba(colour === 'brand' ? brand((r - first) / span) : colour);
      for (let c = 0; c < columns; c++) {
        const cell = cells[r * columns + c];
        if (cell === 1) lit.push([x + centre(c), y + centre(r), body]);
        if (cell === 2) lit.push([x + centre(c), y + centre(r), rgba(BLUSH)]);
      }
    }
    // A blurred pass for the glow, then the crisp dots on top.
    ctx.save();
    ctx.shadowBlur = pitch * GLOW * scale;
    for (const [cx, cy, fill] of lit) {
      ctx.shadowColor = fill;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    for (const [cx, cy, fill] of lit) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** A canvas holding a grid, with room for the glow that spills past its edge. */
  function dotsCanvas(grid, pitch, colour, showsUnlit) {
    const bleed = pitch * BLEED;
    const scale = ratio();
    const width = grid.columns * pitch + bleed * 2;
    const height = grid.rows * pitch + bleed * 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.margin = `${-bleed}px`;
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    paint(ctx, grid, pitch, bleed, bleed, colour, showsUnlit, scale);
    return canvas;
  }

  // MARK: The mark, the name, headings and numbers

  /** How a heading in a given writing is drawn, as in the app. */
  function headingStyle(text) {
    return hasHangul(text)
      ? { rows: 13, weight: 500, reference: '힣뷁' }   // many strokes: a lighter weight keeps them apart
      : { rows: 13, weight: 700, reference: 'bdfhijklOSgjpqy' };
  }

  /** Width the page's text column has, for dots that must not run past it. */
  function columnWidth() {
    const main = document.querySelector('main');
    if (!main) return Infinity;
    const style = getComputedStyle(main);
    return main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  }

  function lightUp(element) {
    const text = element.dataset.text || element.textContent.trim();
    element.dataset.text = text;
    const style = headingStyle(text);
    const rows = Number(element.dataset.rows) || style.rows;
    const weight = Number(element.dataset.weight) || style.weight;
    const reference = 'ref' in element.dataset ? element.dataset.ref : style.reference;
    const grid = gridFromText(text, rows, weight, reference);
    const pitch = Math.min(Number(element.dataset.pitch) || 2.2, columnWidth() / grid.columns);

    const label = document.createElement('span');
    label.className = 'sr';
    label.textContent = text;
    element.replaceChildren(label, dotsCanvas(grid, pitch, 'brand', false));
    element.classList.add('lit');
  }

  function drawMarks() {
    for (const mark of document.querySelectorAll('[data-cat]')) {
      const size = mark.getBoundingClientRect().width || 40;
      const grid = gridFromDrawing(CAT);
      mark.replaceChildren(dotsCanvas(grid, size / grid.rows, 'brand', true));
    }
    for (const element of document.querySelectorAll('.dot')) lightUp(element);
  }

  // MARK: The sign

  function startSign(canvas) {
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let pitch = 0;
    let scale = 1;
    let shots = [];
    let total = 1;
    let background = null;
    const strips = new Map();
    let clock = 0;
    let previous = null;
    let onScreen = true;
    let drawn = '';

    /** Turns the messages into a list of shots, each lasting `duration` seconds. */
    function plan() {
      shots = [];
      for (const message of MESSAGES[language]) {
        const rows = hasHangul(message.text) ? 16 : 15;
        const weight = hasHangul(message.text) ? 700 : 800;
        const shot = (grid, mode, duration) => shots.push({ grid, mode, duration, colour: message.colour });
        if (message.mode === 'still') {
          shot(fittedGrid(message.text, rows, weight, SIGN_COLUMNS - 6), 'still', 3.4);
        } else if (message.mode === 'flash') {
          const words = message.text.split(' ').map((word) => fittedGrid(word, rows, weight, SIGN_COLUMNS - 6));
          for (let round = 0; round < 2; round++) for (const grid of words) shot(grid, 'flash', 0.8);
        } else {
          const grid = gridFromText(message.text, rows, weight);
          shot(grid, 'scroll', (SIGN_COLUMNS + grid.columns) / SPEED + 0.3);
        }
      }
      total = shots.reduce((sum, s) => sum + s.duration, 0);
      strips.clear();
      drawn = '';
      canvas.setAttribute('aria-label', canvas.dataset[`label${language === 'ko' ? 'Ko' : 'En'}`] || '');
    }

    function resize() {
      const width = canvas.clientWidth;
      if (!width) return;
      pitch = width / SIGN_COLUMNS;
      scale = ratio();
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(pitch * SIGN_ROWS * scale);
      background = document.createElement('canvas');
      background.width = canvas.width;
      background.height = canvas.height;
      const b = background.getContext('2d');
      b.fillStyle = '#000';
      b.fillRect(0, 0, background.width, background.height);
      b.scale(scale, scale);
      const off = { columns: SIGN_COLUMNS, rows: SIGN_ROWS, cells: new Uint8Array(SIGN_COLUMNS * SIGN_ROWS) };
      paint(b, off, pitch, 0, 0, YELLOW, true, scale);
      strips.clear();
      drawn = '';
      draw();
    }

    /** The lit dots of one shot, drawn once for the current size. */
    function strip(index) {
      if (!strips.has(index)) {
        const { grid, colour } = shots[index];
        const bleed = pitch * BLEED;
        const s = document.createElement('canvas');
        s.width = Math.ceil((grid.columns * pitch + bleed * 2) * scale);
        s.height = Math.ceil((grid.rows * pitch + bleed * 2) * scale);
        const g = s.getContext('2d');
        g.scale(scale, scale);
        paint(g, grid, pitch, bleed, bleed, colour, false, scale);
        strips.set(index, s);
      }
      return strips.get(index);
    }

    /** Which shot is on at time `t`, where it sits, and how much of it shows. */
    function stateAt(t) {
      if (reduced.matches) {
        const grid = shots[0].grid;
        return { index: 0, column: Math.floor((SIGN_COLUMNS - grid.columns) / 2), shown: grid.columns };
      }
      t %= total;
      let index = 0;
      while (t >= shots[index].duration && index < shots.length - 1) { t -= shots[index].duration; index += 1; }
      const { grid, mode, duration } = shots[index];
      const centred = Math.floor((SIGN_COLUMNS - grid.columns) / 2);
      if (mode === 'scroll') {
        return { index, column: SIGN_COLUMNS - Math.floor(t * SPEED), shown: grid.columns };
      }
      if (mode === 'flash') {
        return { index, column: centred, shown: t < duration - 0.2 ? grid.columns : 0 };
      }
      // Still: the columns light up left to right, stay, then go dark briefly.
      const shown = t > duration - 0.35 ? 0 : Math.min(grid.columns, Math.floor((t / 0.5) * grid.columns));
      return { index, column: centred, shown };
    }

    function draw() {
      if (!background || !shots.length) return;
      const state = stateAt(clock);
      const key = `${state.index}|${state.column}|${state.shown}`;
      if (key === drawn) return;
      drawn = key;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(background, 0, 0);
      if (state.shown <= 0) return;
      const { grid } = shots[state.index];
      const top = Math.floor((SIGN_ROWS - grid.rows) / 2);
      const bleed = pitch * BLEED;
      ctx.save();
      if (state.shown < grid.columns) {
        ctx.beginPath();
        ctx.rect(0, 0, (state.column + state.shown) * pitch * scale, canvas.height);
        ctx.clip();
      }
      ctx.drawImage(strip(state.index), (state.column * pitch - bleed) * scale, (top * pitch - bleed) * scale);
      ctx.restore();
    }

    // The sign's own time stands still while it cannot be seen, so it picks up
    // where it left off. Frames may come slowly; the time between them still counts.
    function frame(now) {
      if (previous !== null && onScreen && !document.hidden) clock += Math.min((now - previous) / 1000, 0.5);
      previous = now;
      draw();
      requestAnimationFrame(frame);
    }

    plan();
    new ResizeObserver(resize).observe(canvas);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        onScreen = entries[0].isIntersecting;
        previous = null;
      }).observe(canvas);
    }
    document.addEventListener('visibilitychange', () => { previous = null; });
    reduced.addEventListener('change', () => { drawn = ''; });
    requestAnimationFrame(frame);
    return { replan: plan };
  }

  // MARK: Language

  const signs = [];

  function setLanguage(next, remember) {
    language = next;
    root.lang = next;
    root.dataset.lang = next;
    for (const button of document.querySelectorAll('[data-set-lang]')) {
      button.setAttribute('aria-pressed', String(button.dataset.setLang === next));
    }
    // Links between the two pages keep the language.
    for (const link of document.querySelectorAll('a[data-keep-lang]')) {
      link.dataset.href = link.dataset.href || link.getAttribute('href');
      link.setAttribute('href', `${link.dataset.href}?lang=${next}`);
    }
    if (remember) {
      // Kept in the address, so a reload or a shared link opens in the same language.
      try {
        const address = new URL(location.href);
        address.searchParams.set('lang', next);
        history.replaceState(null, '', address);
      } catch (error) {
        // Some browsers refuse this for pages opened from a file; the switch still works.
      }
    }
    for (const sign of signs) sign.replan();
  }

  document.addEventListener('DOMContentLoaded', () => {
    setLanguage(language, false);
    for (const button of document.querySelectorAll('[data-set-lang]')) {
      button.addEventListener('click', () => setLanguage(button.dataset.setLang, true));
    }
    for (const canvas of document.querySelectorAll('canvas.sign')) signs.push(startSign(canvas));
    drawMarks();
    let width = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      drawMarks();
    });
  });
})();
