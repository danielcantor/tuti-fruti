# Tuti Fruti

Tuti Fruti multijugador para jugar con la oficina: ruleta de letras compartida, categorías a
elección del dueño de la sala (de 3 a 8, entre Nombre, Serie/Película, Lugar, Color, Marca, Animal,
Fruta o verdura, Comida, Cosa u objeto, Persona famosa, Cantante o banda, Ropa o accesorio y
Excusa para llegar tarde; por defecto las cinco primeras) o al azar: en cada ronda se sortean
de 3 a 6 de las que marque el dueño (por defecto, 5 de las 13), botón **¡Basta!** con cuenta regresiva de 5 s,
revisión con votación para anular respuestas y tabla de puntos acumulada.

Votación: en los primeros 20 segundos de la revisión, cualquiera toca una respuesta que le parece
que no vale y la lleva a votación (después ya no se abren votaciones nuevas). El voto es anónimo: se ven los totales, cuántas personas faltan votar y el voto propio,
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
Next.js (App Router) + Tailwind CSS v4 + Upstash Redis. Los navegadores consultan `/api/state`;
si nada cambió, el servidor responde con una sola lectura de Redis. Cada consulta cuenta para el
plan gratis del hosting, así que la frecuencia depende del momento: cada 1 s durante la ronda y la
revisión (0,5 s en la cuenta regresiva de ¡Basta!), cada 2 s en la sala de espera, cada 5 s en la
pantalla final y cada 15 s con la pestaña oculta (alcanza para no figurar como desconectado).

## Deploy en Vercel
1. Importar el repo en Vercel.
2. En el proyecto: **Storage → Marketplace → Upstash (Redis)** y conectarlo. Carga solo las
   variables `KV_REST_API_URL` y `KV_REST_API_TOKEN` (también sirven `UPSTASH_REDIS_REST_*`).
3. Volver a desplegar.

## Deploy en Netlify
1. Crear una base Redis gratis en [upstash.com](https://upstash.com) (o usar la que ya existe, si
   sigue accesible desde la consola de Upstash) y copiar la URL y el token REST.
2. En Netlify: **Add new project → Import an existing project** y elegir el repo. Netlify detecta
   Next.js solo; `netlify.toml` fija el comando de build y Node 22.
3. En **Project configuration → Environment variables**, cargar `KV_REST_API_URL` y
   `KV_REST_API_TOKEN` (o `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`).
4. Desplegar. Sin esas variables el juego no arranca y el log de funciones lo dice.

Las vistas previas de Netlify (deploy previews y branch deploys) usan otro prefijo en Redis, igual
que las de Vercel, para no mezclar partidas con producción. En el plan gratis cada deploy a
producción gasta créditos, así que conviene no desplegar por cada cambio chico.

## Desarrollo
```bash
npm install
npm run dev        # sin variables de Redis usa memoria (solo para probar en local)
npm test           # lógica y partida completa
```
Pruebas de navegador (Playwright), cada una con el servidor recién iniciado
(`NODE_PATH="$(npm root -g)" node e2e/<prueba>.mjs http://localhost:3000`):
`two-players` (partida con dos), `three-rounds` (partida a 3 rondas), `votes` (tres jugadores
votando), `categories` (elegir categorías), `random-categories` (categorías al azar), `chat` y
`presence` (avisos de entrada y salida).
