# Tuti Fruti

Tuti Fruti multijugador para jugar con la oficina: ruleta de letras compartida, categorías a
elección del dueño de la sala (de 3 a 8, entre Nombre, Serie/Película, Lugar, Color, Marca, Animal,
Fruta o verdura, Comida, Cosa u objeto, Persona famosa, Cantante o banda, Ropa o accesorio y
Excusa para llegar tarde; por defecto las cinco primeras) o al azar: en cada ronda se sortean
de 3 a 6 de las que marque el dueño (por defecto, 5 de las 13), botón **¡Basta!** con cuenta regresiva de 5 s,
revisión con votación para anular respuestas y tabla de puntos acumulada.

Votación: en la revisión, cualquiera toca una respuesta que le parece que no vale y la lleva a
votación. El voto es anónimo: se ven los totales, cuántas personas faltan votar y el voto propio,
nunca quién votó qué. Cada votación dura 20 segundos o hasta que votaron todos los conectados. Se
anula si hay más votos de «no vale» que de «vale»; si empatan, queda. Quien la escribió no vota y
los votos de quien se fue de la sala no cuentan. Mientras haya una votación abierta, el dueño no
puede pasar a la próxima ronda.

Antes de la primera ronda el dueño elige las categorías y cuántas rondas jugar (3, 5, 10 o sin límite); al terminar
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
Pruebas con dos navegadores (Playwright): `node e2e/two-players.mjs http://localhost:3000` 
`node e2e/three-rounds.mjs http://localhost:3000` y `node e2e/votes.mjs http://localhost:3000`
(tres jugadores votando) `node e2e/categories.mjs http://localhost:3000` (elegir categorías) y
`node e2e/random-categories.mjs http://localhost:3000` (categorías al azar);
correr cada una con el servidor recién iniciado.
