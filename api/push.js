import { handler, send, readBody, requireCasa, vapid, q, sendPush, names, kvGet, DEFAULT_CONFIG } from "./_lib.js";

export default handler(async (req, res) => {
  if (req.method === "GET") return send(res, 200, { publicKey: (await vapid()).publicKey });
  await requireCasa(req);
  const b = await readBody(req);
  const person = b.person === "vale" ? "vale" : "kriss";
  if (b.a === "sub") {
    const sub = b.sub;
    if (!sub || !sub.endpoint || !sub.keys) return send(res, 400, { error: "Suscripción inválida" });
    await q(`INSERT INTO subs(endpoint, person, sub, created) VALUES($1,$2,$3,$4) ON CONFLICT(endpoint) DO UPDATE SET person=EXCLUDED.person, sub=EXCLUDED.sub`, [sub.endpoint, person, JSON.stringify(sub), Date.now()]);
    return send(res, 200, { ok: true });
  }
  if (b.a === "unsub") { await q(`DELETE FROM subs WHERE endpoint=$1`, [String(b.endpoint || "")]); return send(res, 200, { ok: true }); }
  if (b.a === "test") {
    const N = names((await kvGet("config"))?.v || DEFAULT_CONFIG);
    const n = await sendPush(person, { title: "🔔 Family App", body: `¡Listo, ${N[person]}! Así te van a llegar los avisos.`, tag: "test" });
    return send(res, 200, { ok: true, sent: n });
  }
  if (b.a === "count") {
    const r = await q(`SELECT person, count(*)::int AS n FROM subs GROUP BY person`);
    return send(res, 200, Object.fromEntries(r.map(x => [x.person, x.n])));
  }
  send(res, 400, { error: "Acción desconocida" });
});
