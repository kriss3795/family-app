import { handler, send, readBody, kvGet, kvSet, DEFAULT_CONFIG, originOf } from "./_lib.js";

const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 6 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join("");

export default handler(async (req, res) => {
  const casa = await kvGet("casa");
  if (req.method === "GET") return send(res, 200, { exists: !!casa });
  const b = await readBody(req);
  if (b.a === "create") {
    if (casa) return send(res, 409, { error: "La casa ya existe. Pide el código a quien la creó." });
    const code = newCode();
    await kvSet("casa", { code, created: Date.now() });
    if (!(await kvGet("config"))) await kvSet("config", DEFAULT_CONFIG);
    await kvSet("origin", originOf(req));
    return send(res, 200, { code });
  }
  if (b.a === "join") {
    if (!casa) return send(res, 404, { error: "La casa todavía no está creada" });
    const code = String(b.code || "").trim().toUpperCase();
    if (code !== casa.v.code) return send(res, 401, { error: "Ese código no es correcto" });
    return send(res, 200, { ok: true, code });
  }
  send(res, 400, { error: "Acción desconocida" });
});
