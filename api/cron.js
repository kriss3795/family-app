// Revisa atrasos y envía avisos push. Lo llama GitHub Actions cada ~10 min. Es seguro llamarlo varias veces: cada aviso sale una sola vez.
import { handler, send, kvGet, kvSet, getConfig, partnerOn, q, nowLocal, tasksFor, deadlineOf, mins, names, other, sendOnce, slotName, DEFAULT_CONFIG } from "./_lib.js";

const FRASES = ["Somos un equipo 💛", "Un paso a la vez.", "Hecho es mejor que perfecto.", "Por nosotros y por Falco 🐣", "Cada check suma para el premio 🏆"];
const list = ts => ts.slice(0, 4).map(t => `${t.emoji || "✅"} ${t.name}`).join(" · ") + (ts.length > 4 ? ` y ${ts.length - 4} más` : "");

export default handler(async (req, res) => {
  const casa = await kvGet("casa");
  if (!casa) return send(res, 200, { skip: "sin casa" });
  const cfg = (await getConfig()).cfg;
  const av = { warn: 30, partner: true, morning: "08:30", ...(cfg.avisos || {}) };
  const N = names(cfg);
  const { date, mins: now } = nowLocal();
  const done = new Set((await q(`SELECT task FROM marcas WHERE date=$1`, [date])).map(r => r.task));
  const today = tasksFor(date, cfg);
  const out = [];
  const atr = p => (p === "vale" ? "atrasada" : "atrasado");

  for (const p of ["kriss", "vale"]) {
    const mine = today.filter(t => t.who === p || t.who === "ambos");
    const pend = mine.filter(t => !done.has(t.id));
    // buenos días
    if (av.morning && now >= mins(av.morning) && now < mins(av.morning) + 180 && mine.length) {
      const first = pend[0];
      out.push(["am", p, await sendOnce(`am:${date}:${p}`, p, {
        title: `☀️ Buenos días, ${N[p]}`,
        body: `Hoy tienes ${mine.length} tareas${first ? `. Parte por: ${first.emoji} ${first.name}` : ""}. ${FRASES[new Date().getDate() % FRASES.length]}`,
        tag: "am",
      })]);
    }
    // agrupar por hora límite
    const byDl = {};
    pend.forEach(t => { const d = deadlineOf(t, cfg); (byDl[d] = byDl[d] || []).push(t); });
    for (const [dl, ts] of Object.entries(byDl)) {
      const D = mins(dl);
      if (av.warn > 0 && now >= D - av.warn && now < D) {
        out.push(["soon", p, dl, await sendOnce(`soon:${date}:${p}:${dl}`, p, {
          title: `⏳ ${N[p]}, quedan ${D - now} min`, body: `Antes de las ${dl}: ${list(ts)}`, tag: `soon-${dl}`,
        })]);
      }
      if (now >= D && now < D + 240) {
        out.push(["late", p, dl, await sendOnce(`late:${date}:${p}:${dl}`, p, {
          title: `⏰ ${N[p]}, se pasó la hora`, body: `Pendiente de ${slotName(ts[0].slot)}: ${list(ts)}. Parte por la más fácil 💪`, tag: `late-${dl}`, requireInteraction: true,
        })]);
        // también le avisa al otro (solo lo que es de esa persona)
        const own = ts.filter(t => t.who === p);
        if (own.length && partnerOn(cfg, other(p))) {
          out.push(["late-partner", other(p), dl, await sendOnce(`latep:${date}:${p}:${dl}`, other(p), {
            title: `🫶 ${N[p]} va ${atr(p)}`, body: `Con: ${list(own)}. Un mensajito de ánimo ayuda 💛`, tag: `latep-${dl}`,
          })]);
        }
      }
    }
  }
  if (Math.random() < 0.05) await q(`DELETE FROM sent WHERE at < $1`, [Date.now() - 40 * 864e5]);
  await kvSet("cron_last", { at: Date.now(), date, now, sent: out.filter(x => x[x.length - 1] > 0).length });
  send(res, 200, { date, now, out });
});
