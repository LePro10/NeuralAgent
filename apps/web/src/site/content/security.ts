// Security section copy and facts (site-audit.md Part B7, DECISIONS D28). Exact algorithms, honest limits.
import { GITHUB } from "../content";

/** The prompt that travels. */
export const PLAIN = "Allow npm test?";
/**
 * AES-256-GCM of PLAIN (15 bytes + 16 byte tag), hex. Not made up: key = SHA-256("NeuralAgent site demo key"),
 * nonce = 96-bit counter 1, no associated data. Reproduce with WebCrypto: subtle.encrypt({ name: "AES-GCM", iv }, key, "Allow npm test?").
 */
export const CIPHER_HEX = "e1b2a579cfb9860848f637d8aa4b8abc13a9c4a3ece4af994e17f612da4766";
export const NONCE_HEX = "000000000001";

/** "e1b2 a579 …" in groups of four. */
export const group4 = (hex: string) => hex.replace(/(.{4})(?=.)/g, "$1 ");

export const SEAL_STEPS = [
  { n: "01", title: "It asks", text: "Claude Code wants to run npm test. NeuralAgent shows the prompt on your computer." },
  { n: "02", title: "It is sealed", text: "Before it leaves, the prompt is encrypted with AES-256-GCM. The key comes from an X25519 handshake between your phone and your computer." },
  { n: "03", title: "The relay carries it", text: "It routes opaque envelopes between devices of the same account. It can read the address on the envelope, never the message." },
  { n: "04", title: "It opens on your phone", text: "Your phone decrypts it and shows Allow or Deny. Your answer travels back the same way." },
] as const;

export const FACTS: { key: string; value: string; href?: string }[] = [
  { key: "Key agreement", value: "X25519. Client ephemeral and static keys with the computer's static key, in a Noise-style handshake." },
  { key: "Key derivation", value: "HKDF-SHA256, label NA-E2E-v1." },
  { key: "Cipher", value: "AES-256-GCM, one key per direction, 96-bit counter nonces, strict counters with a replay window." },
  { key: "Who is allowed", value: "The computer checks the phone's static key against your account's device list." },
  { key: "QR pairing", value: "Pins the computer's key fingerprint: the first 16 bytes of its SHA-256, shown as hex groups." },
  { key: "Device keys", value: "OS keychain on desktop. Android Keystore-wrapped on Android. A non-extractable WebCrypto key in IndexedDB in the browser." },
  { key: "Sign-in", value: "Google OIDC with state, nonce and PKCE; GitHub OAuth with state and PKCE. A 15-minute access token and a rotating per-device refresh token, stored hashed." },
  { key: "Local service", value: "Listens on 127.0.0.1 only, with a 256-bit token file (0600) and an Origin check." },
  { key: "Code", value: "Rust and TypeScript implementations share test vectors. Open source, AGPL-3.0." },
  { key: "Report a problem", value: "Privately, through the Security tab on GitHub (SECURITY.md). Please do not open a public issue.", href: `${GITHUB}/security` },
];

export const LIMITS = [
  {
    title: "Signing in is not pairing.",
    text: "A phone added by signing in, not by QR code, trusts the relay's key directory the first time. Both sides show a fingerprint you can compare. Scanning the QR code also catches a relay that swaps keys.",
  },
  {
    title: "The relay also serves the web app.",
    text: "End-to-end encryption protects against reading the traffic. It does not protect against a compromised server shipping malicious web code. The Android app loads the same web app from the relay.",
  },
] as const;

/** What leaves your computer, and where it goes: one honest table (the privacy page has the full list). */
export const LEAVES: { what: string; where: string }[] = [
  { what: "Your code, files and terminals", where: "Stay on your computer. NeuralAgent itself never uploads them. The agents you run talk to their own providers, as in any terminal." },
  { what: "What you say to Neural", where: "Goes to the model provider you choose, with your own key. The key stays in your system keychain." },
  { what: "Messages to your phone", where: "Cross the relay as ciphertext, between your own devices only." },
  { what: "Account and device data", where: "Kept by the relay when you use remote access: account, device names, public keys, last seen, traffic volume. Listed in the privacy policy." },
  { what: "Update check", where: "The desktop app asks agent.neuralhub.dev for new versions and sends your system, architecture and app version." },
];
