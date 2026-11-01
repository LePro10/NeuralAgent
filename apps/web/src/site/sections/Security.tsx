// Security: "sealed in transit". One real prompt (Allow npm test?) is sealed on the computer, crosses the relay as ciphertext and
// opens on the phone. Scroll-linked (BRIEF 2.5c): on wide screens a pinned stage scrubbed by the shared scroll loop, on phones a
// vertical flow scrubbed by the stage's own position. One number `--k` (0 to 1) drives all geometry in CSS; two text nodes scramble from JS.
// Reduced motion: the complete end state, no loops.
import "./Security.css";
import { useEffect, useRef } from "react";
import { CIPHER_HEX, FACTS, LEAVES, LIMITS, PLAIN, SEAL_STEPS, group4 } from "../content/security";
import { ArrowRight, Check, EyeOff, Lock, LockOpen, Server } from "../content/icons";
import { ActivityMark, Fold, Icon, PaneTitle, prefersReducedMotion, Reveal, Section, SlotLines, useMedia, useScrollProgress } from "../ui";

const CIPHER_PC = `${group4(CIPHER_HEX).slice(0, 29)} …`; // 6 groups
const CIPHER_PH = `${group4(CIPHER_HEX).slice(0, 19)} …`; // 4 groups, fits the phone
const CIPHER_PKT = group4(CIPHER_HEX).slice(0, 9);
const RELAY_LINES = group4(CIPHER_HEX).match(/(?:\S{4} ?){1,4}/g)!.map((l) => l.trim()); // 4 lines of up to 4 groups
const GLYPHS = "0123456789abcdef";

const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (k: number, a: number, b: number) => clamp((k - a) / (b - a));

/** `from` turns into `to`, left to right, with a short band of random hex in between. Deterministic in q, so scrubbing is stable. */
function scramble(from: string, to: string, q: number): string {
  const L = Math.max(from.length, to.length);
  const a = from.padEnd(L);
  const b = to.padEnd(L);
  if (q <= 0) return from;
  if (q >= 1) return to;
  const W = 6;
  const reveal = q * (L + W);
  const seed = Math.floor(q * 70);
  let out = "";
  for (let i = 0; i < L; i++) {
    if (i < reveal - W) out += b[i];
    else if (i < reveal) out += b[i] === " " && a[i] === " " ? " " : GLYPHS[(i * 7 + seed * 5) & 15];
    else out += a[i];
  }
  return out.trimEnd();
}

type SealStep = (typeof SEAL_STEPS)[number];

function Step({ s }: { s: SealStep }) {
  return (
    <li className="seal__step" data-n={s.n.slice(1)}>
      <span className="seal__sn t-label">{s.n}</span>
      <h3>{s.title}</h3>
      <p>{s.text}</p>
    </li>
  );
}

export function Security() {
  const pinned = useMedia("(min-width: 900px) and (min-height: 600px) and (prefers-reduced-motion: no-preference)");
  const wide = useMedia("(min-width: 900px)");
  const track = useRef<HTMLDivElement>(null);
  const pcText = useRef<HTMLSpanElement>(null);
  const phText = useRef<HTMLSpanElement>(null);
  useScrollProgress(track);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let last = -1;
    const apply = (k: number) => {
      el.style.setProperty("--k", k.toFixed(4));
      if (pcText.current) pcText.current.textContent = scramble(PLAIN, CIPHER_PC, seg(k, 0.12, 0.3));
      if (phText.current) phText.current.textContent = scramble(CIPHER_PH, PLAIN, seg(k, 0.7, 0.86));
      el.dataset.step = String(k < 0.12 ? 1 : k < 0.3 ? 2 : k < 0.7 ? 3 : 4);
      if (k > 0.9) el.dataset.ans = "";
      else delete el.dataset.ans;
    };
    if (prefersReducedMotion()) {
      apply(1);
      delete el.dataset.live;
      return;
    }
    el.dataset.live = "";
    const read = () => {
      // The shared scroll loop writes --t (pinned track) or --p (flow) as inline custom properties; this runs right after it,
      // in the same frame (MutationObserver microtask), so it can never read a stale value.
      const v = parseFloat(el.style.getPropertyValue(pinned ? "--t" : "--p"));
      if (!Number.isFinite(v)) return;
      const k = pinned ? clamp((v - 0.05) / 0.88) : clamp((v - 0.3) / 0.36);
      if (Math.abs(k - last) > 0.0003) {
        last = k;
        apply(k);
      }
    };
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ["style"] });
    read();
    return () => mo.disconnect();
  }, [pinned]);

  return (
    <Section id="security" path="security/sealed-in-transit" meta={<span className="na-hide-sm">X25519 · AES-256-GCM</span>} labelledBy="security-h">
      <div className="na-head">
        <SlotLines as="h2" id="security-h" className="t-h2" immediate={false} lines={["Sealed from your computer", "to your phone"]} stop />
        <Reveal as="p" index={2} className="t-lead">
          {pinned ? "Scroll through one prompt." : "One prompt, from your computer to your phone."} It is sealed on your computer, crosses the relay as ciphertext and opens on your phone. The relay can read the envelope&apos;s address (which account, which device), never the message.
        </Reveal>
      </div>

      <div ref={track} className="seal" data-pinned={pinned ? "" : undefined} data-step="1">
        <p className="na-sr">
          Walkthrough: the prompt &quot;{PLAIN}&quot; is encrypted with AES-256-GCM on the computer, carried by the relay as ciphertext it cannot read, and decrypted on the phone, where you answer Allow or Deny.
        </p>
        <div className="seal__sticky">
          <div className="seal__stage">
            {/* 1 + 2: the computer */}
            <div className="seal__node">
              <div className="na-pane seal__pane seal__pc" aria-hidden>
                <PaneTitle status="idle" label="studio/claude-code" meta="your computer" />
                <div className="seal__body">
                  <div className="seal__who">
                    <span className="seal__mk seal__mk--wait"><ActivityMark kind="waiting" size="md" /></span>
                    <span className="seal__mk seal__mk--work"><ActivityMark kind="working" size="md" /></span>
                    <b>Claude Code</b><span>billing-api</span>
                  </div>
                  <div className="seal__ask">
                    <span className="t-label">Bash command</span>
                    <code className="seal__cmd">npm test</code>
                    <span className="seal__q">Do you want to proceed?</span>
                  </div>
                  <div className="seal__env">
                    <span className="seal__lock"><Icon as={LockOpen} size="md" className="seal__lk0" /><Icon as={Lock} size="md" className="seal__lk1" /></span>
                    <span className="seal__msg"><span ref={pcText}>{PLAIN}</span></span>
                    <span className="seal__tag t-label"><span className="seal__t0">message</span><span className="seal__t1">sealed with AES-256-GCM</span></span>
                  </div>
                </div>
              </div>
              <ol className="seal__steps seal__steps--flow" start={1}>
                {SEAL_STEPS.slice(0, 2).map((s) => (
                  <Step key={s.n} s={s} />
                ))}
              </ol>
            </div>

            <div className="seal__wire seal__wire--a" aria-hidden>
              <span className="seal__lit" />
              <span className="seal__pkt"><Icon as={Lock} size={12} />{CIPHER_PKT}</span>
            </div>

            {/* 3: the relay */}
            <div className="seal__node">
              <div className="na-pane seal__pane seal__relay" aria-hidden>
                <PaneTitle status="idle" label="relay/agent.neuralhub.dev" />
                <div className="seal__body">
                  <div className="seal__who"><Icon as={Server} size="md" /><b>Relay</b><span>routes envelopes</span></div>
                  <dl className="seal__rows">
                    <div><dt>route</dt><dd>computer<Icon as={ArrowRight} size={13} className="seal__arr" />phone</dd></div>
                    <div><dt>account</dt><dd>same</dd></div>
                    <div className="seal__bodyrow"><dt>body</dt><dd className="seal__hex">{RELAY_LINES.map((l, i) => <span key={i}>{l}</span>)}</dd></div>
                  </dl>
                  <div className="seal__blind"><Icon as={EyeOff} size="md" /><span><b>Cannot read the message.</b></span></div>
                </div>
              </div>
              <ol className="seal__steps seal__steps--flow" start={3}>
                {SEAL_STEPS.slice(2, 3).map((s) => (
                  <Step key={s.n} s={s} />
                ))}
              </ol>
            </div>

            <div className="seal__wire seal__wire--b" aria-hidden>
              <span className="seal__lit" />
              <span className="seal__pkt"><Icon as={Lock} size={12} />{CIPHER_PKT}</span>
            </div>

            {/* 4: the phone */}
            <div className="seal__node">
              <div className="seal__phone" aria-hidden>
                <div className="seal__island" />
                <div className="seal__screen">
                  <div className="seal__who"><ActivityMark kind="idle" size="md" /><b>Inbox</b></div>
                  <div className="seal__stack">
                  <p className="seal__quiet">Nothing needs you.</p>
                  <div className="seal__card">
                    <div className="seal__who seal__who--sm"><ActivityMark kind="waiting" size="md" /><span className="seal__id"><b>Claude Code</b><span>billing-api</span></span></div>
                    <p className="seal__msg seal__msg--ph"><span ref={phText}>{CIPHER_PH}</span></p>
                    <div className="seal__btns">
                      <span className="seal__btn">Deny</span>
                      <span className="seal__btn seal__btn--yes"><Icon as={Check} size={14} className="seal__ck" />Allow</span>
                    </div>
                  </div>
                  </div>
                </div>
              </div>
              <ol className="seal__steps seal__steps--flow" start={4}>
                {SEAL_STEPS.slice(3).map((s) => (
                  <Step key={s.n} s={s} />
                ))}
              </ol>
            </div>
          </div>
          {/* Wide screens: one caption slot per step under the scene, with a track that fills as the prompt travels. */}
          <div className="seal__rowwrap">
            <i className="seal__track" aria-hidden><i className="seal__fill" /></i>
            <ol className="seal__steps seal__steps--row">
              {SEAL_STEPS.map((s) => (
                <Step key={s.n} s={s} />
              ))}
            </ol>
          </div>
          <p className="seal__note t-label">The ciphertext is real: AES-256-GCM of that text under a demo key. The app derives its keys from the handshake below.</p>
        </div>
      </div>

      <div className="seal__more">
        <Reveal className="seal__facts-wrap">
          <Fold title="Exactly how" wide={wide} className="seal__facts">
            <dl className="seal__dl">
              {FACTS.map((f) => (
                <div key={f.key} className="seal__fact">
                  <dt>{f.key}</dt>
                  <dd>
                    {f.value}
                    {f.href && (
                      <>
                        {" "}
                        <a className="na-link" href={f.href} target="_blank" rel="noopener noreferrer">Open the Security tab</a>.
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </Fold>
        </Reveal>

        <div className="seal__side">
          <Reveal kind="pane" className="na-pane seal__limits">
            <PaneTitle status="idle" label="security/honest-limits" />
            <div className="seal__lbody">
              {LIMITS.map((l) => (
                <div key={l.title}>
                  <h3>{l.title}</h3>
                  <p>{l.text}</p>
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal index={1} className="seal__leaves-wrap">
            <Fold title="What leaves your computer" wide={wide} className="seal__leaves">
              <dl className="seal__dl">
                {LEAVES.map((l) => (
                  <div key={l.what} className="seal__fact">
                    <dt>{l.what}</dt>
                    <dd>{l.where}</dd>
                  </div>
                ))}
              </dl>
              <p className="seal__after">
                The <a className="na-link" href="/privacy/">privacy policy</a> lists everything the relay stores.
              </p>
            </Fold>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

