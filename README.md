# Tuti Fruti

Tuti Fruti multijugador para jugar con la oficina: ruleta de letras compartida, cinco categorías
(Nombre, Serie/Película, Lugar, Color, Marca), botón **¡Basta!** con cuenta regresiva de 5 s,
revisión donde cualquiera puede anular respuestas y tabla de puntos acumulada.

Antes de la primera ronda se elige cuántas rondas jugar (3, 5, 10 o sin límite); al terminar
aparece el ganador. Cortes automáticos para que nada quede colgado: si nadie canta ¡Basta! en
3 minutos la ronda se corta sola, y una partida sin límite termina si nadie gira en 15 minutos.

Puntaje: 10 si la respuesta es única, 5 si alguien más puso lo mismo, 0 si está vacía,
no empieza con la letra o fue anulada.

## Stack
Next.js (App Router) + Tailwind CSS v4 + Upstash Redis. Los navegadores consultan `/api/state`
cada segundo; si nada cambió, el servidor responde con una sola lectura de Redis.

## Deploy en Vercel
1. Importar el repo en Vercel.
2. En el proyecto: **Storage → Marketplace → Upstash (Redis)** y conectarlo. Carga solo las
   variables `KV_REST_API_URL` y `KV_REST_API_TOKEN` (también sirven `UPSTASH_REDIS_REST_*`).
3. Volver a desplegar.

## Desarrollo
```bash
npm install
npm run dev        # sin variables de Redis usa memoria (solo para probar en local)
npm test           # lógica y partida completa
```
Pruebas con dos navegadores (Playwright): `node e2e/two-players.mjs http://localhost:3000` y
`node e2e/three-rounds.mjs http://localhost:3000`.
