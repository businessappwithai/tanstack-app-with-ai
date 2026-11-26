/**
 * The chat assistant, as this application sees it.
 *
 * An orchestrator can put a chat assistant in front of this application: a
 * person signs in here as usual and then works through the chat, which shows
 * this application's pages in a frame. The assistant has no access of its own.
 * It forwards the person's own session, and every guard here answers as it
 * would for the browser.
 *
 * Two switches, both the administrator's (Admin → System Config, `sys_system`):
 *
 *   CHAT_ENABLED     the assistant may be used at all
 *   CHAT_ONLY_MODE   the assistant is the only way in for everybody but
 *                    administrators
 *
 * This file is what chat-only mode needs: a way to tell a request that came
 * through the assistant from one that did not. Two things count, both signed
 * with `CHAT_BRIDGE_SECRET`, which the assistant holds:
 *
 *  - the `chat_embed` cookie, set when the assistant opens a page for a person
 *    by ticket, naming that person;
 *  - the `x-chat-bridge` header, on the assistant's own calls.
 *
 * Chat-only mode decides *where people work*. It is not what protects a
 * record — the access guards do that, wherever the request comes from — so
 * when the secret is not configured, or the switch cannot be read, nothing is
 * locked.
 */

export const CHAT_ONLY_CODE = 'CHAT_ONLY';
export const EMBED_COOKIE = 'chat_embed';
export const BRIDGE_HEADER = 'x-chat-bridge';

interface Statement {
  aud: string;
  sub: string;
  exp: number;
  [claim: string]: unknown;
}

const encoder = new TextEncoder();

const fromBase64Url = (text: string): Uint8Array =>
  new Uint8Array(Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function chatBridgeSecret(env: Record<string, string | undefined> = process.env): string | null {
  const secret = env.CHAT_BRIDGE_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

/**
 * The payload when the statement is genuine, unexpired and for `audience`.
 * `<base64url(JSON)>.<base64url(HMAC-SHA256)>` — the assistant's `signing.ts`
 * writes it; keep the two in step.
 */
export async function verifyStatement(
  secret: string,
  token: string | null | undefined,
  audience: string,
  now: number = Date.now(),
): Promise<Statement | null> {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  if (!sameBytes(await hmac(secret, body), fromBase64Url(token.slice(dot + 1)))) return null;
  let payload: Statement;
  try {
    payload = JSON.parse(Buffer.from(fromBase64Url(body)).toString('utf8')) as Statement;
  } catch {
    return null;
  }
  if (payload.aud !== audience) return null;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null;
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
  return payload;
}

function cookieValue(header: unknown, name: string): string | null {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/** True when this request came through the assistant, for this person. */
export async function cameThroughChat(
  secret: string,
  headers: Record<string, unknown>,
  email: string,
): Promise<boolean> {
  const bridge = headers[BRIDGE_HEADER];
  if (typeof bridge === 'string' && (await verifyStatement(secret, bridge, 'bridge'))) return true;
  const embed = await verifyStatement(secret, cookieValue(headers.cookie, EMBED_COOKIE), 'embed');
  return embed !== null && embed.sub === email.toLowerCase();
}

export interface ChatSwitches {
  enabled: boolean;
  chatOnly: boolean;
}

const truthy = (value: unknown): boolean => value === 'true' || value === '1';

/** Read both switches from `sys_system`. A missing row is the default: enabled, not chat-only. */
export async function readChatSwitches(kysely: any): Promise<ChatSwitches> {
  const rows: Array<{ config_key: string; config_value: string | null; is_active: boolean }> = await kysely
    .selectFrom('sys_system')
    .select(['config_key', 'config_value', 'is_active'])
    .where('config_key', 'in', ['CHAT_ENABLED', 'CHAT_ONLY_MODE'])
    .execute();
  const value = (key: string): string | null => {
    const row = rows.find((candidate) => candidate.config_key === key && candidate.is_active !== false);
    return row ? row.config_value : null;
  };
  const enabled = value('CHAT_ENABLED');
  return { enabled: enabled === null ? true : truthy(enabled), chatOnly: truthy(value('CHAT_ONLY_MODE')) };
}

let cached: { until: number; value: ChatSwitches } | null = null;

/** The switches, re-read at most every few seconds: this is asked on every request. */
export async function chatSwitches(kysely: any, now: number = Date.now()): Promise<ChatSwitches> {
  if (cached && cached.until > now) return cached.value;
  const value = await readChatSwitches(kysely);
  cached = { until: now + 5_000, value };
  return value;
}

/** For the tests, and for an administrator's change to take effect at once. */
export function forgetChatSwitches(): void {
  cached = null;
}

/**
 * Whether chat-only mode refuses this request. Administrators are never
 * refused: somebody has to be able to reach the application when the assistant
 * is down, if only to turn the switch off.
 */
export async function chatOnlyRefuses(input: {
  kysely: any;
  headers: Record<string, unknown>;
  email: string | null | undefined;
  isMaster: boolean;
  env?: Record<string, string | undefined>;
}): Promise<boolean> {
  if (input.isMaster || !input.email) return false;
  const secret = chatBridgeSecret(input.env);
  if (!secret) return false;
  let switches: ChatSwitches;
  try {
    switches = await chatSwitches(input.kysely);
  } catch {
    return false;
  }
  if (!switches.enabled || !switches.chatOnly) return false;
  return !(await cameThroughChat(secret, input.headers, input.email));
}
