"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type ClientState, type Phase, derivePhase, initialGame } from "./game";

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
      const res = await fetch(`/api/state?pid=${pid}&v=${v}`, { cache: "no-store" });
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

  // Polling: 1 s normalmente, más rápido durante el giro o la cuenta regresiva.
  useEffect(() => {
    if (!pid) return;
    let stop = false;
    let t: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await poll();
      if (stop) return;
      const p = phaseRef.current;
      t = setTimeout(loop, p === "spinning" || p === "stopping" ? 400 : 1000);
    };
    loop();
    return () => {
      stop = true;
      clearTimeout(t);
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
