import { handler, send, readBody, requireCasa, kvGet, kvSet, q, nowLocal, tasksFor, names, other, sendPush, originOf, getConfig, partnerOn } from "./_lib.js";

const PEOPLE = ["kriss", "vale"];
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

export default handler(async (req, res) => {
  await requireCasa(req);
  if (!(await kvGet("origin"))) await kvSet("origin", originOf(req));

  if (req.method === "GET") {
    const now = nowLocal();
    const [cfg, nota] = await Promise.all([getConfig(), kvGet("nota")]);
    const since = new Date(Date.now() - 70 * 864e5).toISOString().slice(0, 10);
    const marks = await q(`SELECT id, date, task, by, at FROM marcas WHERE date >= $1`, [since]);
    return send(res, 200, {
      config: cfg.cfg, configUpdated: cfg.updated,
      nota: nota ? nota.v : null,
      marks: marks.map(m => ({ ...m, at: Number(m.at) })),
      now,
    });
  }

  const b = await readBody(req);
  const cfg = (await getConfig()).cfg;
  const N = names(cfg);

  if (b.a === "mark" || b.a === "unmark") {
    const date = isDate(b.date) ? b.date : nowLocal().date;
    const task = String(b.task || "").slice(0, 80);
    if (!task) return send(res, 400, { error: "Falta la tarea" });
    const id = `${date}_${task}`;
    if (b.a === "unmark") { await q(`DELETE FROM marcas WHERE id=$1`, [id]); return send(res, 200, { ok: true }); }
    const by = PEOPLE.includes(b.by) ? b.by : "kriss";
    const ins = await q(`INSERT INTO marcas(id,date,task,by,at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING id`, [id, date, task, by, Date.now()]);
    // aviso al otro
    if (ins.length && date === nowLocal().date && partnerOn(cfg, other(by))) {
      const t = (cfg.tasks || []).find(x => x.id === task);
      if (t) {
        const list = tasksFor(date, cfg).filter(x => x.who === by || x.who === "ambos");
        const done = new Set((await q(`SELECT task FROM marcas WHERE date=$1`, [date])).map(r => r.task));
        const all = list.length && list.every(x => done.has(x.id));
        const payload = all
          ? { title: `🎉 ¡${N[by]} completó todo lo suyo hoy!`, body: "El equipo va con todo. Vamos por el premio 🏆", tag: "partner-all" }
          : { title: `💚 ${N[by]} hizo una tarea`, body: `${t.emoji || "✅"} ${t.name} · ${list.filter(x => done.has(x.id)).length}/${list.length} de hoy`, tag: "partner" };
        try { await sendPush(other(by), payload); } catch (e) { console.error(e); }
      }
    }
    return send(res, 200, { ok: true });
  }

  if (b.a === "config") {
    const c = b.config;
    if (!c || typeof c !== "object" || !Array.isArray(c.tasks)) return send(res, 400, { error: "Configuración inválida" });
    if (JSON.stringify(c).length > 200000) return send(res, 400, { error: "Configuración muy grande" });
    if ((Number(c.v) || 1) < 2) return send(res, 409, { error: "La app está desactualizada. Ciérrala y ábrela de nuevo." });
    // si alguien guardó entremedio, se rechaza para no pisar su cambio
    const cur = await kvGet("config");
    if (b.base != null && cur && Number(b.base) !== cur.updated) return send(res, 409, { error: "La configuración cambió mientras editabas" });
    const saved = { ...c, v: Number(c.v) };
    await kvSet("config", saved);
    const now = await kvGet("config");
    return send(res, 200, { ok: true, config: now.v, updated: now.updated });
  }

  if (b.a === "nota") {
    const text = String(b.text || "").slice(0, 280).trim();
    const by = PEOPLE.includes(b.by) ? b.by : "kriss";
    if (!text) return send(res, 400, { error: "La notita está vacía" });
    await kvSet("nota", { text, by, at: Date.now() });
    try { await sendPush(other(by), { title: `💌 Notita de ${N[by]}`, body: text, tag: "nota" }); } catch (e) { console.error(e); }
    return send(res, 200, { ok: true });
  }

  send(res, 400, { error: "Acción desconocida" });
});
