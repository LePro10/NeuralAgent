/**
 * One xterm.js view of a daemon session. The daemon holds the real terminal; this view attaches
 * (snapshot + live bytes), sends keystrokes, and reports its size so the PTY matches the pane.
 */
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type ITheme } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { useClient, usePlatform } from "../lib/store";
import { THEME_EVENT } from "../lib/theme";

const FONT = '"IBM Plex Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';

function theme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(`--color-term-${name}`).trim();
  return {
    background: v("bg"),
    foreground: v("fg"),
    cursor: v("cursor"),
    cursorAccent: v("bg"),
    selectionBackground: v("selection"),
    black: v("black"),
    red: v("red"),
    green: v("green"),
    yellow: v("yellow"),
    blue: v("blue"),
    magenta: v("magenta"),
    cyan: v("cyan"),
    white: v("white"),
    brightBlack: v("bright-black"),
    brightRed: v("bright-red"),
    brightGreen: v("bright-green"),
    brightYellow: v("bright-yellow"),
    brightBlue: v("bright-blue"),
    brightMagenta: v("bright-magenta"),
    brightCyan: v("bright-cyan"),
    brightWhite: v("bright-white"),
  };
}

let fontReady: Promise<unknown> | null = null;
const loadFont = () => (fontReady ??= Promise.all([document.fonts.load(`13px "IBM Plex Mono"`), document.fonts.load(`bold 13px "IBM Plex Mono"`)]).catch(() => {}));

/** App shortcuts that must not reach the terminal. */
export function isAppShortcut(e: KeyboardEvent): boolean {
  const mod = navigator.platform.startsWith("Mac") ? e.metaKey : e.ctrlKey && e.shiftKey;
  if (!mod) return false;
  return /^(Digit[0-9]|KeyT|KeyW|KeyD|KeyN|KeyK|KeyB|Enter|BracketLeft|BracketRight|Comma|Backslash)$/.test(e.code);
}

/** `touch`: phones type through the pane's input line; the terminal only shows output. */
export function TerminalView({ sid, focused, startedAt, webgl, touch, onFocus }: { sid: string; focused: boolean; startedAt: number; webgl: boolean; touch?: boolean; onFocus: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const client = useClient();
  const platform = usePlatform();
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  useEffect(() => {
    const el = host.current!;
    let disposed = false;
    const t = new Terminal({
      fontFamily: FONT,
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: theme(),
      macOptionIsMeta: false, // Option types @, € … on many keyboard layouts
      macOptionClickForcesSelection: true,
      rightClickSelectsWord: true,
      drawBoldTextInBrightColors: false,
      minimumContrastRatio: 1,
    });
    term.current = t;
    const retheme = () => (t.options.theme = theme());
    window.addEventListener(THEME_EVENT, retheme);
    const fit = new FitAddon();
    t.loadAddon(fit);
    const uni = new Unicode11Addon();
    t.loadAddon(uni);
    t.unicode.activeVersion = "11";
    t.loadAddon(new WebLinksAddon((_e, uri) => platform.openExternal(uri)));

    t.attachCustomKeyEventHandler((e) => {
      if (isAppShortcut(e)) return false;
      // Shift+Enter = newline inside the prompt (agents read ESC CR as "insert newline").
      if (e.type === "keydown" && e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        client.write(sid, "\x1b\r");
        return false;
      }
      return true;
    });
    t.onData((d) => client.write(sid, d));
    t.onBinary((d) => client.write(sid, d));

    let size = { cols: 0, rows: 0 };
    const refit = () => {
      if (disposed || el.clientWidth < 20 || el.clientHeight < 20) return;
      const dims = fit.proposeDimensions();
      if (!dims || !Number.isFinite(dims.cols)) return;
      const cols = Math.max(20, dims.cols);
      const rows = Math.max(4, dims.rows);
      if (cols !== t.cols || rows !== t.rows) t.resize(cols, rows);
      if (cols !== size.cols || rows !== size.rows) {
        size = { cols, rows };
        client.req({ m: "term_resize", p: { sid, cols, rows } }).catch(() => {});
      }
    };

    let detach = () => {};
    void loadFont().then(() => {
      if (disposed) return;
      t.open(el);
      // Android keyboards garble input to xterm's hidden textarea (composition events), and a
      // keyboard popping up over the output on every tap is in the way.
      if (touch) {
        t.options.disableStdin = true;
        t.textarea?.setAttribute("inputmode", "none");
      }
      if (webgl) {
        try {
          const gl = new WebglAddon();
          gl.onContextLoss(() => gl.dispose());
          t.loadAddon(gl);
        } catch (e) {
          console.warn("WebGL renderer unavailable, using DOM renderer", e);
        }
      }
      refit();
      if (focusedRef.current) t.focus();
      detach = client.attach(sid, {
        reset(snapshot) {
          t.reset();
          t.write(snapshot);
          refit();
        },
        data(bytes) {
          t.write(bytes);
        },
      });
    });

    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(refit);
    });
    ro.observe(el);
    const onFocusIn = () => onFocusRef.current();
    el.addEventListener("focusin", onFocusIn);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("focusin", onFocusIn);
      window.removeEventListener(THEME_EVENT, retheme);
      detach();
      t.dispose();
      term.current = null;
    };
    // Restarted process (new started_at) = new stream.
  }, [sid, startedAt, webgl, touch, client, platform]);

  useEffect(() => {
    if (focused) term.current?.focus();
  }, [focused]);

  // Padding on a wrapper: FitAddon measures the host's box.
  return (
    <div className="h-full w-full overflow-hidden pt-1 pl-2" onMouseDown={() => onFocusRef.current()}>
      <div ref={host} className="h-full w-full" />
    </div>
  );
}
