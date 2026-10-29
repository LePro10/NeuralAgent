import { api, b64u, unb64u } from "./api";

// Challenge encoding. The relay's `util::token()` is base64url(32 random bytes) and WebAuthn
// verification compares the string in clientDataJSON.challenge with that same token. Browsers
// write base64url(challenge bytes) there, so the bytes we hand to WebAuthn must be
// base64url-DECODE(token); then the browser's encoding reproduces the token exactly.
// (Passing the token's UTF-8 bytes would produce a different string and fail.)

type Opts = Record<string, unknown> & { challenge: string };
type CredDesc = { type: "public-key"; id: string; transports?: AuthenticatorTransport[] };

const descriptors = (list: unknown): PublicKeyCredentialDescriptor[] =>
  ((list as CredDesc[] | undefined) ?? []).map((c) => ({ ...c, id: unb64u(c.id) }));

export const passkeysSupported = () => typeof PublicKeyCredential !== "undefined" && !!navigator.credentials;

/** Creates a passkey and registers it with the relay (which then sets the cookie). */
export async function createPasskey() {
  const o = (await api.registerStart()) as Opts & { user: { id: string; name: string; displayName: string } };
  const cred = (await navigator.credentials.create({
    publicKey: {
      ...(o as object),
      challenge: unb64u(o.challenge),
      user: { ...o.user, id: unb64u(o.user.id) },
      excludeCredentials: descriptors(o.excludeCredentials),
    } as unknown as PublicKeyCredentialCreationOptions,
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was created");
  const r = cred.response as AuthenticatorAttestationResponse;
  await api.registerFinish({ id: cred.id, client_data: b64u(r.clientDataJSON), attestation: b64u(r.attestationObject) });
}

/** Proves possession of the passkey (second factor); the relay answers with the cookie. */
export async function unlockWithPasskey() {
  const o = (await api.loginStart()) as Opts;
  const cred = (await navigator.credentials.get({
    publicKey: { ...(o as object), challenge: unb64u(o.challenge), allowCredentials: descriptors(o.allowCredentials) } as unknown as PublicKeyCredentialRequestOptions,
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was used");
  const r = cred.response as AuthenticatorAssertionResponse;
  await api.loginFinish({
    id: cred.id,
    client_data: b64u(r.clientDataJSON),
    authenticator_data: b64u(r.authenticatorData),
    signature: b64u(r.signature),
  });
}
