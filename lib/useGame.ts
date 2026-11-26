"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type ClientState, HEARTBEAT_MS, HIDDEN_POLL_MS, type Phase, derivePhase, initialGame } from "./game";

const PID_KEY = "tf:pid";
const NAME_KEY = "tf:name";

function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* sin storage: sigue funcionando en esta pestaña */
  }
}

const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * Cada cuánto consultar al servidor según la fase. Con la pestaña oculta
 * alcanza con avisar "sigo acá" antes de que se cumplan los 30 s sin señales.
 */
export function pollDelay(phase: Phase | null, hidden: boolean): number {
  if (hidden) return HIDDEN_POLL_MS;
  switch (phase) {
    case "stopping":
      return 500; // cuenta regresiva de ¡Basta!: hay que guardar lo último que se escribe
    case "spinning":
    case "playing":
    case "review":
      return 1000; // ¡Basta! de otro y votos: tienen que llegar rápido
    case "finished":
      return 5000;
    default:
      return 2000; // sala de espera y chat
  }
}

export function useGame() {
  const [ready, setReady] = useState(false);
  const [pid, setPid] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [state, setState] = useState<ClientState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(0);
  const offset = useRef(0);
  const verRef = useRef<number | null>(null);
  const phaseRef = useRef<Phase | null>(null);
  const forceFull = useRef(true);
  const lastBeat = useRef(0);
  const nameRef = useRef<string | null>(null);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  const serverNow = useCallback(() => Date.now() + offset.current, []);

  useEffect(() => {
    let id = safeGet(PID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      safeSet(PID_KEY, id);
    }
    // Lectura única de localStorage al montar: no hay otra forma de hacerlo sin romper la hidratación.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPid(id);
    setName(safeGet(NAME_KEY));
    setReady(true);
  }, []);

  const poll = useCallback(async () => {
    if (!pid) return;
    const v = forceFull.current || verRef.current === null ? "" : String(verRef.current);
    try {
      // Cada HEARTBEAT_MS la consulta también avisa "sigo acá".
      const beat = Date.now() - lastBeat.current >= HEARTBEAT_MS;
      if (beat) lastBeat.current = Date.now();
      const res = await fetch(`/api/state?pid=${pid}&v=${v}${beat ? "&hb=1" : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as ClientState | { same: true; ver: number; serverNow: number };
      offset.current = data.serverNow - Date.now();
      setOffline(false);
      if ("same" in data) return;
      forceFull.current = false;
      verRef.current = data.ver;
      phaseRef.current = data.game.phase;
      setState(data);
      // Si el servidor ya no tiene al jugador (ej. salió en otra pestaña), volver a anotarlo.
      const n = nameRef.current;
      if (n && !data.players.some((p) => p.id === pid)) {
        forceFull.current = true;
        fetch("/api/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "join", playerId: pid, name: n }),
        }).catch(() => {});
      }
    } catch {
      setOffline(true);
    }
  }, [pid]);

  // Polling: cada consulta es una llamada al servidor y es lo que más gasta
  // del plan gratis del hosting, así que se consulta solo lo necesario.
  useEffect(() => {
    if (!pid) return;
    let stop = false;
    let t: ReturnType<typeof setTimeout>;
    let gen = 0; // si se reinicia el ciclo, el anterior no agenda otra consulta
    const loop = async () => {
      const my = ++gen;
      clearTimeout(t);
      await poll();
      if (stop || my !== gen) return;
      t = setTimeout(loop, pollDelay(phaseRef.current, isHidden()));
    };
    // Al volver a la pestaña, ponerse al día enseguida.
    const onVisible = () => {
      if (!isHidden()) loop();
    };
    document.addEventListener("visibilitychange", onVisible);
    loop();
    return () => {
      stop = true;
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pid, poll]);

  // Reloj local para la ruleta y la cuenta regresiva.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset.current), 200);
    return () => clearInterval(t);
  }, []);

  const game = state?.game ?? { ...initialGame(), phase: "lobby" as Phase };
  const phase: Phase = state ? derivePhase({ ...state.game, results: state.results }, now || state.serverNow) : "lobby";

  // Si la fase cambió por tiempo, pedir el estado completo (ej. respuestas de todos en la revisión).
  useEffect(() => {
    if (state && phase !== state.game.phase) {
      forceFull.current = true;
      phaseRef.current = phase;
    }
  }, [phase, state]);

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      if (!pid) return false;
      try {
        const res = await fetch("/api/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, playerId: pid }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setError(j.error ?? "Algo falló");
          return false;
        }
        if (body.type !== "answer") {
          forceFull.current = true;
          poll();
        }
        return true;
      } catch {
        setError("Sin conexión");
        return false;
      }
    },
    [pid, poll],
  );

  const join = useCallback(
    async (n: string) => {
      const ok = await send({ type: "join", name: n });
      if (ok) {
        safeSet(NAME_KEY, n.trim());
        setName(n.trim());
      }
      return ok;
    },
    [send],
  );

  const leave = useCallback(async () => {
    nameRef.current = null;
    safeSet(NAME_KEY, null);
    setName(null);
    await send({ type: "leave" });
  }, [send]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3500);
    return () => clearTimeout(t);
  }, [error]);

  return { ready, pid, name, state, game, phase, now, serverNow, error, offline, send, join, leave };
}
