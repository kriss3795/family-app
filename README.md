# Family App 🏡

Tareas del hogar en equipo para Kriss y Vale: checklist compartido en tiempo real, turnos alternados, reparto justo por esfuerzo, premios semanales y mensuales, y notificaciones push al celular.

## Cómo está armada
- `public/` — la app (PWA instalable): `index.html`, `sw.js` (notificaciones), `manifest.webmanifest`, íconos.
- `api/` — funciones de Vercel:
  - `setup` crea la casa y entrega el código para entrar.
  - `state` lee y guarda tareas, marcas y notitas (avisa al otro cuando alguien marca).
  - `push` registra los teléfonos para recibir notificaciones.
  - `cron` revisa atrasos y manda los avisos (buenos días, por vencer, atrasado, y le avisa también al otro).
- `.github/workflows/avisos.yml` — llama a `/api/cron` cada 10 minutos.
- Base de datos: Neon (Postgres). Las tablas y las llaves de notificación se crean solas.

## Puesta en marcha
1. Importar el repo en Vercel.
2. En el proyecto de Vercel → Storage → conectar **Neon** (crea `DATABASE_URL`).
3. Redeploy. Abrir la app → «Crear nuestra casa» → invitar con el link.
4. En GitHub → Settings → Secrets and variables → Actions → Variables: `APP_URL` = la URL de Vercel (si no es `https://family-app-lemon-ten.vercel.app`).
