// Lógica compartida del servidor (archivos con "_" no se publican como endpoints en Vercel)
import webpush from "web-push";
import DEFAULTS from "./_default-config.js";

export const TZ = "America/Santiago";
export const DEFAULT_CONFIG = DEFAULTS;
const DEF_SLOTS = { manana: "11:00", tarde: "18:00", noche: "21:30" };
const SLOT_NAMES = { manana: "la mañana", tarde: "la tarde", noche: "la noche" };

// ---------- base de datos ----------
let _ready = null;
async function connect() {
  const env = process.env;
  const anyPg = () => { // busca cualquier variable con una URL de Postgres (p. ej. STORAGE_URL si Vercel usó otro prefijo)
    const ks = Object.keys(env).filter(k => /^postgres(ql)?:\/\//.test(String(env[k] || "")));
    return env[ks.find(k => /DATABASE_URL$/.test(k) && !/UNPOOLED/.test(k)) || ks.find(k => /_URL$/.test(k) && !/UNPOOLED|NO_SSL|NON_POOLING/.test(k)) || ks[0]];
  };
  const url = env.DATABASE_URL || env.POSTGRES_URL || env.STORAGE_URL || anyPg();
  if (!url) throw Object.assign(new Error("Falta conectar la base de datos (Neon) en Vercel."), { status: 500 });
  let run;
  if (env.LOCAL_PG) {
    const pg = (await import("pg")).default;
    const pool = new pg.Pool({ connectionString: url });
    run = async (text, params = []) => (await pool.query(text, params)).rows;
  } else {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    run = (text, params = []) => sql.query(text, params);
  }
  const ddl = [
    `CREATE TABLE IF NOT EXISTS kv (k text PRIMARY KEY, v jsonb NOT NULL, updated bigint NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS marcas (id text PRIMARY KEY, date text NOT NULL, task text NOT NULL, by text NOT NULL, at bigint NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS marcas_date ON marcas(date)`,
    `CREATE TABLE IF NOT EXISTS subs (endpoint text PRIMARY KEY, person text NOT NULL, sub jsonb NOT NULL, created bigint NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sent (id text PRIMARY KEY, at bigint NOT NULL)`,
  ];
  for (const s of ddl) {
    // dos arranques en paralelo pueden chocar creando la misma tabla: se reintenta una vez
    try { await run(s); } catch (e) { await new Promise(r => setTimeout(r, 300)); await run(s); }
  }
  return run;
}
function getQuery() {
  if (!_ready) _ready = connect().catch(e => { _ready = null; throw e; });
  return _ready;
}
export async function q(text, params) { return (await getQuery())(text, params); }
export async function kvGet(k) { const r = await q(`SELECT v, updated FROM kv WHERE k=$1`, [k]); return r[0] ? { v: r[0].v, updated: Number(r[0].updated) } : null; }
export async function kvSet(k, v) { await q(`INSERT INTO kv(k,v,updated) VALUES($1,$2,$3) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v, updated=EXCLUDED.updated`, [k, JSON.stringify(v), Date.now()]); }

// ---------- http ----------
export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}
export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}
export function handler(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { console.error(e); send(res, e.status || 500, { error: e.message || "Error" }); }
  };
}
export async function requireCasa(req) {
  const code = String(req.headers["x-casa"] || "").trim().toUpperCase();
  const casa = await kvGet("casa");
  if (!casa) throw Object.assign(new Error("La casa todavía no está creada"), { status: 404 });
  if (!code || code !== casa.v.code) throw Object.assign(new Error("Código de la casa incorrecto"), { status: 401 });
  return casa.v;
}
export function originOf(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || (String(host).startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// ---------- fechas en hora de Chile ----------
export function nowLocal(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(d).map(x => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  const hour = Number(p.hour) % 24;
  return { date, wd, mins: hour * 60 + Number(p.minute) };
}
function parseDate(s) { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function addDaysUTC(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
export const mins = hm => { const [h, m] = String(hm).split(":").map(Number); return h * 60 + (m || 0); };

// ---------- tareas ----------
export function whoFor(t, dateStr, config) {
  if (t.assign !== "alterna") return t.assign;
  const anchor = parseDate(config.anchor || "2026-11-09"), d0 = parseDate(dateStr), days = t.days || [];
  let idx = 0;
  if (d0 >= anchor) { for (let x = anchor; x < d0; x = addDaysUTC(x, 1)) if (days.includes(x.getUTCDay())) idx++; }
  else { for (let x = d0; x < anchor; x = addDaysUTC(x, 1)) if (days.includes(x.getUTCDay())) idx--; }
  const first = t.first || "kriss", other = first === "kriss" ? "vale" : "kriss";
  const fl = (t.flips || []).filter(f => f <= dateStr).length; // «invertir turnos» desde esa fecha
  return (Math.abs(idx) + fl) % 2 === 0 ? first : other;
}
export function tasksFor(dateStr, config) {
  const wd = parseDate(dateStr).getUTCDay();
  return (config.tasks || []).filter(t => (t.days || []).includes(wd)).map(t => ({ ...t, who: whoFor(t, dateStr, config) }));
}
export function deadlineOf(t, config) {
  const sl = (config.slots || {})[t.slot || "manana"];
  return t.hora || (sl && sl.until) || DEF_SLOTS[t.slot || "manana"] || "11:00";
}
export const names = c => ({ kriss: (c.names && c.names.kriss) || "Kriss", vale: (c.names && c.names.vale) || "Vale" });
export const other = p => (p === "kriss" ? "vale" : "kriss");
// ¿esta persona quiere avisos de lo que hace / atrasa el otro? (antes era un sí/no compartido)
export function partnerOn(cfg, person) { const v = (cfg.avisos || {}).partner; return v && typeof v === "object" ? v[person] !== false : v !== false; }
export const slotName = s => SLOT_NAMES[s] || "hoy";

// ---------- push ----------
export async function vapid() {
  let v = await kvGet("vapid");
  if (!v) {
    const keys = webpush.generateVAPIDKeys();
    await q(`INSERT INTO kv(k,v,updated) VALUES('vapid',$1,$2) ON CONFLICT(k) DO NOTHING`, [JSON.stringify(keys), Date.now()]);
    v = await kvGet("vapid"); // si otro proceso ganó, se usan sus llaves
  }
  return v.v;
}
export async function sendPush(person, payload) {
  const rows = await q(`SELECT endpoint, sub FROM subs WHERE person=$1`, [person]);
  if (!rows.length) return 0;
  const keys = await vapid();
  const origin = (await kvGet("origin"))?.v || "";
  webpush.setVapidDetails(origin.startsWith("https://") ? origin : "mailto:familyapp@example.com", keys.publicKey, keys.privateKey);
  let ok = 0;
  await Promise.all(rows.map(async r => {
    try { await webpush.sendNotification(r.sub, JSON.stringify(payload), { TTL: 3600, urgency: "high" }); ok++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410 || e.statusCode === 403) await q(`DELETE FROM subs WHERE endpoint=$1`, [r.endpoint]); else console.error("push", e.statusCode, e.body); }
  }));
  return ok;
}
// envía una sola vez por id (para no repetir avisos)
export async function sendOnce(id, person, payload) {
  const r = await q(`INSERT INTO sent(id, at) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id`, [id, Date.now()]);
  if (!r.length) return 0;
  let n = 0;
  try { n = await sendPush(person, payload); } catch (e) { console.error(e); }
  // si no llegó a ningún teléfono, se borra la marca para reintentar en la próxima revisión
  if (!n) await q(`DELETE FROM sent WHERE id=$1`, [id]);
  return n;
}

// ---------- configuración con migraciones ----------
// v2: tareas de la Vale en la semana pasan a la noche (llega ~18:00), esfuerzo ajustado y reparto ~59/41
export async function getConfig() {
  const row = await kvGet("config");
  let cfg = row ? row.v : null;
  if (!cfg) return { cfg: DEFAULT_CONFIG, updated: 0 };
  if ((cfg.v || 1) < 2) {
    cfg = { ...cfg, tasks: DEFAULT_CONFIG.tasks, v: 2 };
    await kvSet("config", cfg);
    const r = await kvGet("config");
    return { cfg: r.v, updated: r.updated };
  }
  if ((cfg.v || 1) < 3) {
    // v3: Fauna y perros grandes siempre de Kriss; se quita «doblar ropa» (lo hace la nana)
    const all = [0, 1, 2, 3, 4, 5, 6];
    const drop = new Set(["fauna-finde", "fauna-guardar-finde", "ropa-doblar"]); // doblar ropa lo hace la nana
    const tasks = (cfg.tasks || []).filter(t => !drop.has(t.id)).map(t =>
      ["fauna", "fauna-guardar", "perros-grandes"].includes(t.id) ? { ...t, assign: "kriss", days: all } : t);
    cfg = { ...cfg, tasks, v: 3 };
    await kvSet("config", cfg);
    const r = await kvGet("config");
    return { cfg: r.v, updated: r.updated };
  }
  return { cfg, updated: row.updated };
}
