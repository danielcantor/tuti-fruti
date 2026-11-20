"use client";

import { useEffect, useRef, useState } from "react";
import { CHAT_MAX_LEN, type ChatMessage } from "@/lib/game";

const SEEN_KEY = "tf:chatSeen";

function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function writeSeen(at: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(at));
  } catch {
    /* sin storage: el contador se reinicia al recargar */
  }
}

const time = (at: number) =>
  new Date(at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

type Props = {
  messages: ChatMessage[];
  me: string;
  onSend: (text: string) => Promise<boolean>;
};

export default function Chat({ messages, me, onSend }: Props) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const lastAt = messages.length ? messages[messages.length - 1].at : 0;

  // Lectura única de localStorage al montar.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeen(readSeen());
  }, []);

  // Con el panel abierto, todo lo que llega queda leído.
  useEffect(() => {
    if (open && lastAt) {
      writeSeen(lastAt);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeen(lastAt);
    }
  }, [open, lastAt]);

  // Bajar al último mensaje al abrir o cuando llega uno nuevo.
  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, messages.length]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const unread = seen === null ? 0 : messages.filter((m) => m.playerId !== me && m.at > seen).length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    const ok = await onSend(t);
    setSending(false);
    if (ok) setText("");
    inputRef.current?.focus();
  };

  return (
    <>
      {open && (
        <section
          role="dialog"
          aria-label="Chat"
          className="fixed inset-x-0 bottom-0 z-40 flex h-[70dvh] flex-col rounded-t-3xl border border-line bg-card shadow-2xl sm:inset-x-auto sm:right-6 sm:bottom-24 sm:h-[30rem] sm:w-[22rem] sm:rounded-3xl"
        >
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-display text-lg font-extrabold">Chat</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar chat"
              className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-paper hover:text-ink"
            >
              ✕
            </button>
          </header>

          <ol ref={listRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <li className="m-auto text-center text-sm text-muted">Todavía no hay mensajes. ¡Saludá!</li>
            )}
            {messages.map((m) => {
              const mine = m.playerId === me;
              return (
                <li key={m.id} className={`flex max-w-[85%] flex-col ${mine ? "items-end self-end" : "items-start"}`}>
                  {!mine && <span className="px-1 text-xs font-semibold text-muted">{m.name}</span>}
                  <p
                    className={`rounded-2xl px-3 py-2 text-sm break-words ${
                      mine ? "rounded-br-md bg-accent text-accent-ink" : "rounded-bl-md bg-paper"
                    }`}
                  >
                    {m.text}
                  </p>
                  <span className="px-1 text-[0.7rem] text-muted">{time(m.at)}</span>
                </li>
              );
            })}
          </ol>

          <form onSubmit={submit} className="flex gap-2 border-t border-line p-3">
            <input
              ref={inputRef}
              value={text}
              maxLength={CHAT_MAX_LEN}
              onChange={(e) => setText(e.target.value)}
              placeholder="Escribí un mensaje"
              aria-label="Mensaje"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-2 outline-none focus:border-ink"
            />
            <button
              disabled={!text.trim() || sending}
              className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-paper disabled:opacity-40"
            >
              Enviar
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Cerrar chat" : unread ? `Abrir chat, ${unread} sin leer` : "Abrir chat"}
        aria-expanded={open}
        className={`fixed right-4 bottom-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-ink text-2xl text-paper shadow-lg transition hover:scale-105 active:scale-95 sm:right-6 sm:bottom-6 ${
          open ? "max-sm:hidden" : ""
        }`}
      >
        <span aria-hidden>💬</span>
        {unread > 0 && !open && (
          <span
            data-testid="chat-unread"
            className="absolute -top-1 -right-1 grid h-6 min-w-6 place-items-center rounded-full bg-accent px-1.5 text-xs font-bold text-accent-ink"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </>
  );
}
