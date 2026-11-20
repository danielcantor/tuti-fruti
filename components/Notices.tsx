"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/game";

type Props = { messages: ChatMessage[]; me: string };

const SHOW_MS = 4500;

/** Avisos flotantes cuando alguien entra o se va de la sala. */
export default function Notices({ messages, me }: Props) {
  const [visible, setVisible] = useState<ChatMessage[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    const notices = messages.filter((m) => m.kind);
    // Primera carga: lo que ya estaba no se anuncia.
    if (seen.current === null) {
      seen.current = new Set(notices.map((m) => m.id));
      return;
    }
    const fresh = notices.filter((m) => !seen.current!.has(m.id));
    if (fresh.length === 0) return;
    for (const m of fresh) seen.current.add(m.id);
    const mine = fresh.filter((m) => m.playerId !== me);
    if (mine.length === 0) return;
    setVisible((v) => [...v, ...mine].slice(-3));
    const ids = new Set(mine.map((m) => m.id));
    // El temporizador vive aparte: si el efecto vuelve a correr, el aviso igual se cierra.
    timers.current.push(setTimeout(() => setVisible((v) => v.filter((m) => !ids.has(m.id))), SHOW_MS));
  }, [messages, me]);

  if (visible.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 top-4 z-50 mx-auto flex max-w-sm flex-col items-center gap-2"
    >
      {visible.map((m) => (
        <p
          key={m.id}
          data-testid="notice"
          className="animate-pop rounded-full border border-line bg-card px-4 py-2 text-sm shadow-lg"
        >
          <span aria-hidden>{m.kind === "join" ? "👋 " : "🚪 "}</span>
          <strong>{m.name}</strong> {m.text}
        </p>
      ))}
    </div>
  );
}
