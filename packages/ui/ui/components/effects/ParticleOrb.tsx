/**
 * A particle sphere — presence for an assistant. It breathes when idle, bands
 * and swirls while thinking, and ripples with each streamed word while
 * speaking (bump `pulse`). A pointer or finger pushes the particles away.
 *
 * WebGL points: every particle's motion is closed-form, so the whole
 * simulation runs in the vertex shader; a frame is a few uniforms and one
 * draw call. The fragment shader computes each square's exact pixel coverage,
 * so particles glide at sub-pixel precision.
 *
 * Budget: idle and untouched it draws at 30 fps; it stops when offscreen,
 * when the tab is hidden, when `paused`, and in rest mode (html.rest) while
 * idle. Colours default to the accent theme (accent, orb, swirl, sand).
 * Without WebGL (or with reduced motion and `still`) it falls back to a
 * static glowing sphere.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { prefersReducedMotion } from '../../lib/motion';

export type OrbMood = 'idle' | 'thinking' | 'speaking';

export interface ParticleOrbProps {
  mood?: OrbMood;
  /** Four colours (cap, belly, accents). Defaults to the theme: accent, --orb-1, --orb-swirl-a, sand. */
  colors?: string[];
  /** 0..1 pulse, bumped per streamed word. */
  pulse?: number;
  className?: string;
  /** Particle budget; scaled down automatically on small canvases. */
  density?: number;
  paused?: boolean;
  interactive?: boolean;
}

/** Resolves any CSS colour (incl. var(--…)) to rgb via a 1px canvas. */
function rgbOf(css: string, el: Element): [number, number, number] {
  const resolved = css.startsWith('var(') ? getComputedStyle(el).getPropertyValue(css.slice(4, -1).trim()).trim() || '#b9d3ff' : css;
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return [185, 211, 255];
  c.fillStyle = resolved;
  c.fillRect(0, 0, 1, 1);
  const d = c.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}
const THEME = ['var(--color-accent)', 'var(--orb-1)', 'var(--orb-swirl-a)', 'var(--color-sand)'];
const isResting = () => document.documentElement.classList.contains('rest');

const TARGETS: Record<OrbMood, { amp: number; spin: number; band: number; ripple: number; glow: number }> = {
  idle: { amp: .035, spin: .12, band: 0, ripple: 0, glow: .55 },
  thinking: { amp: .09, spin: .55, band: 1, ripple: 0, glow: .85 },
  speaking: { amp: .05, spin: .25, band: .2, ripple: 1, glow: 1 },
};

/** Idle and untouched, 30 fps is indistinguishable; thinking/speaking get the display's rate. */
const CALM_MS = 1000 / 30;

// Same maths as the former per-particle JS loop, now per vertex.
const VERT = `
attribute vec3 a_dir;
attribute float a_seed;
attribute vec3 a_col;
uniform vec2 u_res;
uniform vec4 u_rot;     // cos/sin of the Y spin, cos/sin of the X tilt
uniform vec4 u_shape;   // amp, band, ripple, pulse
uniform vec4 u_frame;   // t, R, breathe, dpr
uniform vec3 u_ptr;     // x, y (canvas px), on
varying vec3 v_col;
varying float v_a;
varying vec2 v_c;
varying float v_h;
void main() {
  vec3 d = a_dir; float s = a_seed; float t = u_frame.x; float R = u_frame.y;
  float wob = sin(d.x * 3.1 + t * 1.7 + s * 6.0) * cos(d.y * 2.7 - t * 1.3) * u_shape.x;
  float band = u_shape.y * sin(d.y * 9.0 - t * 3.4 + s * 0.6) * 0.05;
  float rip = u_shape.z * (sin(d.z * 7.0 + d.y * 3.0 - t * 7.0) * 0.025 + u_shape.w * 0.07 * sin(s * 40.0 + t * 10.0));
  vec3 p = d * (R * u_frame.z * (1.0 + wob + band + rip));
  float x1 = p.x * u_rot.x + p.z * u_rot.y, z1 = -p.x * u_rot.y + p.z * u_rot.x;
  float y2 = p.y * u_rot.z - z1 * u_rot.w, z2 = p.y * u_rot.w + z1 * u_rot.z;
  float persp = 1.0 / (1.0 - z2 / (R * 4.2));
  vec2 px = u_res * 0.5 + vec2(x1, y2) * persp;
  if (u_ptr.z > 0.01) {
    vec2 dd = px - u_ptr.xy; float d2 = dot(dd, dd); float pr = 70.0 * u_frame.w;
    if (d2 < pr * pr) px += dd * ((1.0 - d2 / (pr * pr)) * 26.0 * u_frame.w * u_ptr.z / sqrt(d2 + 1.0) * 0.06);
  }
  float depth = (z2 / R + 1.0) / 2.0;
  // Twelve alpha steps, as the old colour buckets had.
  float a = clamp(floor((0.12 + depth * 0.88) * 11.0 * (0.75 + 0.25 * sin(t * 2.0 + s * 20.0)) + 0.5), 0.0, 11.0);
  v_a = (a + 1.0) / 12.0;
  v_col = a_col;
  float size = (0.55 + depth * 1.25) * u_frame.w * (1.0 + u_shape.w * 0.4);
  v_h = size * 0.5;
  v_c = vec2(px.x, u_res.y - px.y); // window coordinates are y-up
  gl_PointSize = size + 2.0;
  gl_Position = vec4(px.x / u_res.x * 2.0 - 1.0, 1.0 - px.y / u_res.y * 2.0, 0.0, 1.0);
}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 v_col;
varying float v_a;
varying vec2 v_c;
varying float v_h;
void main() {
  // Exact overlap of the particle's square with this pixel: sub-pixel motion stays smooth.
  vec2 o = max(min(gl_FragCoord.xy + 0.5, v_c + v_h) - max(gl_FragCoord.xy - 0.5, v_c - v_h), 0.0);
  float cov = o.x * o.y;
  if (cov <= 0.0) discard;
  gl_FragColor = vec4(v_col, 1.0) * (v_a * cov);
}`;

export function ParticleOrb({ mood = 'idle', pulse = 0, colors, className, density = 1400, paused = false, interactive = true }: ParticleOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const live = useRef({ mood, pulse, paused });
  live.current.mood = mood;
  live.current.paused = paused;
  const kick = useRef<() => void>(() => {});
  useEffect(() => { live.current.pulse = Math.max(live.current.pulse, pulse); kick.current(); }, [pulse]);
  useEffect(() => { if (!paused) kick.current(); }, [paused, mood]);
  // Android drops WebGL contexts in standby: rebuild once it's back.
  const [generation, setGeneration] = useState(0);
  const [fallback, setFallback] = useState(false);
  const colorKey = (colors ?? THEME).join();

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl || gl.isContextLost()) { setFallback(true); return; }
    const reduced = prefersReducedMotion();
    const PALETTE = (colors ?? THEME).slice(0, 4).map((c) => rgbOf(c, canvas));
    while (PALETTE.length < 4) PALETTE.push(PALETTE[PALETTE.length - 1]);

    const compile = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const STRIDE = 7 * 4;
    const attr = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, offset);
    };
    attr('a_dir', 3, 0); attr('a_seed', 1, 12); attr('a_col', 3, 16);
    const u = (name: string) => gl.getUniformLocation(program, name);
    const uRes = u('u_res'), uRot = u('u_rot'), uShape = u('u_shape'), uFrame = u('u_frame'), uPtr = u('u_ptr');
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    let W = 0, H = 0, dpr = 1, R = 0, n = 0;
    const build = () => {
      const r = canvas.getBoundingClientRect();
      // Particles are sub-2px squares: 1.5× is visually identical to 3× and fills far fewer pixels.
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = Math.max(1, Math.round(r.width * dpr));
      H = Math.max(1, Math.round(r.height * dpr));
      canvas.width = W; canvas.height = H;
      gl.viewport(0, 0, W, H);
      R = Math.min(W, H) * .34;
      const want = Math.round(Math.min(density, Math.max(260, (R / dpr) ** 2 * .09)));
      if (want === n) return;
      n = want;
      const data = new Float32Array(n * 7);
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 2, rad = Math.sqrt(1 - y * y), th = golden * i;
        // Colour bands by latitude with a little scatter: ice cap, azure belly, lilac and sand accents.
        const t = (y + 1) / 2 + (Math.random() - .5) * .35;
        const [cr, cg, cb] = PALETTE[t > .72 ? 0 : t > .45 ? 2 : t > .2 ? 1 : 3];
        data.set([Math.cos(th) * rad, y, Math.sin(th) * rad, Math.random(), cr / 255, cg / 255, cb / 255], i * 7);
      }
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    };
    build();

    const cur = { ...TARGETS.idle };
    const pointer = { x: -1e9, y: -1e9, on: 0 };
    let raf = 0, timer = 0, t = 0, last = performance.now(), inView = true, disposed = false;
    let glowO = '', glowT = '';
    const calm = () => live.current.mood === 'idle' && pointer.on < .01 && live.current.pulse < .01;
    const running = () => inView && !live.current.paused && document.visibilityState === 'visible' && !(calm() && isResting());
    const later = (ms: number) => {
      if (raf || timer || disposed) return;
      timer = window.setTimeout(() => { timer = 0; if (!disposed) raf = requestAnimationFrame(draw); }, Math.max(0, ms));
    };

    function draw(now: number) {
      raf = 0;
      if (disposed || gl!.isContextLost()) return;
      // Calm frames sit on every other vsync at 60 Hz: a frame that comes early just waits one more.
      if (calm() && last && now - last < CALM_MS - 3) { raf = requestAnimationFrame(draw); return; }
      const dt = Math.min((now - last) / 1000, .05);
      last = now;
      const tgt = TARGETS[live.current.mood];
      const k = 1 - Math.exp(-dt * 3.2);
      cur.amp += (tgt.amp - cur.amp) * k; cur.spin += (tgt.spin - cur.spin) * k;
      cur.band += (tgt.band - cur.band) * k; cur.ripple += (tgt.ripple - cur.ripple) * k;
      cur.glow += (tgt.glow - cur.glow) * k;
      live.current.pulse *= Math.exp(-dt * 3.5);
      const pulseV = live.current.pulse;
      t += dt * (reduced ? .2 : 1);
      pointer.on += ((pointer.x > -1e8 ? 1 : 0) - pointer.on) * k;

      const ay = t * cur.spin, ax = -.38 + Math.sin(t * .21) * .06;
      const g = gl!;
      g.clear(g.COLOR_BUFFER_BIT);
      g.uniform2f(uRes, W, H);
      g.uniform4f(uRot, Math.cos(ay), Math.sin(ay), Math.cos(ax), Math.sin(ax));
      g.uniform4f(uShape, cur.amp, cur.band, cur.ripple, pulseV);
      g.uniform4f(uFrame, t, R, 1 + Math.sin(t * 1.3) * .012 + pulseV * .045, dpr);
      g.uniform3f(uPtr, pointer.x, pointer.y, pointer.on);
      g.drawArrays(g.POINTS, 0, n);

      // The glow only changes with mood and pulse: no style write (and no style recalc) while it rests.
      const el = glowRef.current;
      if (el) {
        const o = (cur.glow * .9).toFixed(3), tr = `scale(${(1 + pulseV * .12 + cur.band * .06).toFixed(3)})`;
        if (o !== glowO) { el.style.opacity = o; glowO = o; }
        if (tr !== glowT) { el.style.transform = tr; glowT = tr; }
      }
      // Wake a little before the frame is due (measured from this frame's vsync, not the timer),
      // so rAF lands on the right vsync instead of one late or early.
      if (running()) { if (calm()) later(CALM_MS - (performance.now() - now) - 10); else raf = requestAnimationFrame(draw); }
    }
    const request = () => {
      if (disposed || raf) return;
      window.clearTimeout(timer); timer = 0;
      last = performance.now();
      raf = requestAnimationFrame(draw);
    };
    const wake = () => { if (running()) request(); };
    kick.current = wake;

    const ro = new ResizeObserver(() => { build(); request(); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { inView = e.isIntersecting; if (inView) request(); });
    io.observe(canvas);
    document.addEventListener('visibilitychange', wake);
    const mo = new MutationObserver(wake);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = (e.clientX - r.left) * dpr; pointer.y = (e.clientY - r.top) * dpr;
      wake();
    };
    const leave = () => { pointer.x = -1e9; pointer.y = -1e9; };
    if (interactive) {
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerdown', move);
      canvas.addEventListener('pointerleave', leave);
      canvas.addEventListener('pointerup', leave);
      canvas.addEventListener('pointercancel', leave);
    }
    const onLost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; window.clearTimeout(timer); timer = 0; };
    const onRestored = () => setGeneration((x) => x + 1);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    request();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf); window.clearTimeout(timer);
      ro.disconnect(); io.disconnect(); mo.disconnect();
      document.removeEventListener('visibilitychange', wake);
      kick.current = () => {};
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerdown', move);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('pointerup', leave);
      canvas.removeEventListener('pointercancel', leave);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      gl.deleteBuffer(buf); gl.deleteProgram(program);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density, interactive, generation, colorKey]);

  return (
    <div className={cn('relative', className)}>
      <div
        ref={glowRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full will-change-transform"
        style={{ opacity: fallback ? 0.9 : undefined, background: 'radial-gradient(circle at 50% 58%, color-mix(in oklab, var(--orb-1) 42%, transparent), color-mix(in oklab, var(--orb-swirl-a) 18%, transparent) 34%, transparent 62%)' }}
      />
      {fallback && (
        // No WebGL: a still sphere in the same colours.
        <div aria-hidden="true" className="absolute inset-[16%] rounded-full opacity-80"
          style={{ background: 'radial-gradient(circle at 42% 30%, color-mix(in oklab, var(--color-accent) 70%, transparent), color-mix(in oklab, var(--orb-1) 45%, transparent) 45%, transparent 72%)' }} />
      )}
      <canvas ref={canvasRef} className="relative block h-full w-full" style={{ touchAction: 'pan-y' }} aria-hidden="true" />
    </div>
  );
}
