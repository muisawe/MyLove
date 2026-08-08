/* موسيقى الخلفية
       The bundler replaces document.documentElement, so anything mounted
       before that is discarded. The Audio object lives on window and never
       enters the DOM, so playback survives untouched; only the toggle button
       is re-mounted.

       Three iOS realities shape this code:
       - The element volume setter is a no-op there. Where that is detected,
         output is routed through a Web Audio gain node, which iOS does honour,
         so the fade is real instead of a full-volume cut-in. The graph is only
         built on that path — createMediaElementSource is irreversible, so
         desktop keeps the proven element-volume route.
       - Playback is armed on 'click', never 'pointerdown', so an attempted
         scroll cannot start the music.
       - The Ring/Silent switch mutes ambient audio invisibly: play() resolves
         and currentTime advances either way. So the UI never claims sound is
         audible, it only ever reports what was asked for.

       Nothing is fetched until she asks for it — the track is 1.9 MB and most
       visits before the 15th will never play it.
  */

(function () {
  if (window.__bgm) return;

  var SRC = 'bgm.m4a';
  var HOST_ID = '__bgm_host';
  var VOLUME = 0.55;

  var audio = new Audio();
  // preload MUST be set before src. Assigning src runs the resource selection
  // algorithm immediately, and it reads preload as it stands at that moment —
  // so the old order fetched all 1.9 MB on every visit, exactly the thing the
  // comment above promises it does not do. Verified in Chrome: bgm.m4a was the
  // second request on the page, before any interaction.
  audio.preload = 'none';
  audio.src = SRC;
  audio.loop = true;
  audio.setAttribute('playsinline', '');
  window.__bgm = audio;

  // Probe the volume setter once. On iOS it silently refuses, and a fade
  // loop waiting for a value that cannot change would never terminate.
  audio.volume = 0.5;
  var canFade = Math.abs(audio.volume - 0.5) < 0.01;
  audio.volume = 1;

  var want = false;   // what she asked for — not what the element reports
  var dead = false;
  var fade = null;
  var ctx = null, gainNode = null;

  // iOS-only rescue path: gain is honoured where element volume is not.
  function ensureGraph() {
    if (ctx || canFade) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      var c = new AC();
      var src = c.createMediaElementSource(audio);
      var g = c.createGain();
      g.gain.value = 0;
      src.connect(g);
      g.connect(c.destination);
      ctx = c;
      gainNode = g;
    } catch (e) {
      ctx = null;
      gainNode = null;
    }
  }

  function fadeTo(target, done) {
    clearInterval(fade);
    if (gainNode && ctx) {
      gainNode.gain.setTargetAtTime(target, ctx.currentTime, 0.22);
      if (done) setTimeout(done, 700);
      return;
    }
    if (!canFade) { if (done) done(); return; }
    var step = target > audio.volume ? 0.04 : -0.07;
    fade = setInterval(function () {
      var v = audio.volume + step;
      if ((step > 0 && v >= target) || (step < 0 && v <= target)) {
        clearInterval(fade);
        fade = null;
        audio.volume = Math.max(0, Math.min(1, target));
        if (done) done();
      } else {
        audio.volume = Math.max(0, Math.min(1, v));
      }
    }, 40);
  }

  function paint() {
    var btn = document.getElementById('__bgm_btn');
    if (!btn) return;
    var on = want && !audio.paused && !dead;
    btn.classList.toggle('on', on);
    // Describes the request. Whether sound is audible cannot be known.
    var label = on ? 'إيقاف الموسيقى' : 'تشغيل الموسيقى';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function play() {
    if (dead) return Promise.reject(new Error('bgm dead'));
    want = true;
    // Both must happen inside the gesture to have any effect.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    ensureGraph();
    if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    if (audio.preload !== 'auto') { audio.preload = 'auto'; }
    var p = audio.play();
    return (p && p.then ? p : Promise.resolve()).then(function () {
      if (canFade) audio.volume = 0;
      fadeTo(VOLUME);
      paint();
    }, function (err) {
      // Without this the refused autoplay leaves want=true, and the very
      // first press of the button reads as "already playing" and stops it.
      want = false;
      paint();
      throw err;
    });
  }

  function stop() {
    want = false;
    fadeTo(0, function () { if (!want) audio.pause(); paint(); });
    paint();
  }

  // 'click' rather than 'pointerdown': a scroll attempt must not start music.
  var EVENTS = ['click', 'keydown'];
  function onGesture(e) {
    var t = e.target;
    if (t && t.closest && t.closest('#' + '__bgm_btn')) return;
    play().then(disarm, function () {});
  }
  function arm() { EVENTS.forEach(function (t) { document.addEventListener(t, onGesture, true); }); }
  function disarm() { EVENTS.forEach(function (t) { document.removeEventListener(t, onGesture, true); }); }

  ['play', 'pause', 'ended', 'stalled', 'waiting', 'emptied'].forEach(function (t) {
    audio.addEventListener(t, paint);
  });
  audio.addEventListener('error', function () {
    dead = true;
    want = false;
    disarm();
    var btn = document.getElementById('__bgm_btn');
    if (btn) btn.style.display = 'none';
  });

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'أغنيتنا',
        artist: 'إلى هبوشتي',
        artwork: [{ src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' }]
      });
      navigator.mediaSession.setActionHandler('play', function () { play().catch(function () {}); });
      navigator.mediaSession.setActionHandler('pause', stop);
    } catch (e) {}
  }

  // Autoplay with sound is refused everywhere, so this only ever succeeds
  // where the visitor has already granted the origin permission.
  play().then(disarm, arm);

  function mount() {
    var host = document.createElement('div');
    host.id = HOST_ID;
    host.innerHTML =
      '<style>' +
      '#__bgm_btn{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom));' +
      'z-index:2147483000;width:46px;height:46px;' +
      'display:flex;align-items:center;justify-content:center;border:0;border-radius:50%;cursor:pointer;' +
      'background:rgba(255,255,255,.86);color:#6b6764;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);' +
      'box-shadow:0 2px 14px rgba(0,0,0,.13);transition:color .3s,transform .3s,box-shadow .3s;padding:0}' +
      '#__bgm_btn:hover{transform:scale(1.07);box-shadow:0 4px 20px rgba(0,0,0,.18)}' +
      '#__bgm_btn:focus-visible{outline:2px solid #d6006c;outline-offset:3px}' +
      '#__bgm_btn.on{color:#d6006c}' +
      '#__bgm_btn .off{display:none}#__bgm_btn.on .off{display:block}#__bgm_btn.on .idle{display:none}' +
      '#__bgm_btn.on .bar{animation:__bgm_eq .9s ease-in-out infinite}' +
      '#__bgm_btn .bar:nth-child(2){animation-delay:.15s}#__bgm_btn .bar:nth-child(3){animation-delay:.3s}' +
      '@keyframes __bgm_eq{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}' +
      '@media (prefers-reduced-motion:reduce){#__bgm_btn .bar{animation:none}}' +
      '@media (forced-colors:active){#__bgm_btn{border:2px solid ButtonText;background:ButtonFace}}' +
      '</style>' +
      '<button id="__bgm_btn" type="button" aria-pressed="false" ' +
      'aria-label="تشغيل الموسيقى" title="تشغيل الموسيقى">' +
      '<svg class="idle" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>' +
      '<svg class="off" width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor">' +
      '<rect class="bar" x="3.5" y="6" width="3" height="12" rx="1.5" style="transform-origin:5px 12px"/>' +
      '<rect class="bar" x="10.5" y="6" width="3" height="12" rx="1.5" style="transform-origin:12px 12px"/>' +
      '<rect class="bar" x="17.5" y="6" width="3" height="12" rx="1.5" style="transform-origin:19px 12px"/>' +
      '</g></svg></button>';
    document.body.appendChild(host);

    document.getElementById('__bgm_btn').addEventListener('click', function (e) {
      e.stopPropagation();
      // Branch on intent, not audio.paused — mid-fade the element still
      // reports playing, which would invert a quick second tap.
      if (want) stop();
      else play().then(disarm, function () {});
    });
    if (dead) document.getElementById('__bgm_btn').style.display = 'none';
    paint();
  }

  // The document swap discards the button. Watch for it rather than only
  // polling, so it returns within a frame instead of half a second.
  function ensure() { if (document.body && !document.getElementById(HOST_ID)) mount(); }
  try { new MutationObserver(ensure).observe(document, { childList: true }); } catch (e) {}
  setInterval(ensure, 1000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure);
  else ensure();
})();
