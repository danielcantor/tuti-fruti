"use client";

import type { RoundResult } from "@/lib/game";

type Props = {
  players: { id: string; name: string; online: boolean }[];
  totals: Record<string, number>;
  results: RoundResult[];
  nameOf: (id: string) => string;
  me: string;
  onReset: () => void;
  ownerId: string | null;
  turnId: string | null;
  onLeave: () => void;
};

export default function Scoreboard({
  players,
  totals,
  results,
  nameOf,
  me,
  onReset,
  onLeave,
  ownerId,
  turnId,
}: Props) {
  const ids = Array.from(new Set([...players.map((p) => p.id), ...Object.keys(totals)]));
  ids.sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0));
  const top = ids.length && (totals[ids[0]] ?? 0) > 0 ? totals[ids[0]] : null;

  return (
    <aside className="flex flex-col gap-5 self-start rounded-3xl lg:sticky lg:top-6 border border-line bg-card p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl font-extrabold tracking-tight">Tabla</h2>
        <span className="text-xs text-muted">
          {results.length} {results.length === 1 ? "ronda" : "rondas"}
        </span>
      </div>

      <ol className="flex flex-col gap-1">
        {ids.length === 0 && <li className="text-sm text-muted">Todavía no entró nadie.</li>}
        {ids.map((id, i) => {
          const pts = totals[id] ?? 0;
          const online = players.find((p) => p.id === id)?.online ?? false;
          return (
            <li
              key={id}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 ${id === me ? "bg-accent-soft" : ""}`}
            >
              <span className="w-5 text-right text-sm tabular-nums text-muted">{i + 1}</span>
              <span
                title={online ? "Conectado" : "Desconectado"}
                className={`h-2 w-2 shrink-0 rounded-full ${online ? "bg-ok" : "bg-line"}`}
              />
              <span className={`flex-1 truncate font-medium ${online ? "" : "text-muted"}`}>
                {nameOf(id)}
                {top !== null && pts === top && " 👑"}
                {id === ownerId && (
                  <span title="Dueño de la sala" className="ml-1.5 rounded bg-ink px-1 py-px align-middle text-[0.65rem] font-semibold text-paper">
                    dueño
                  </span>
                )}
                {id === turnId && (
                  <span title="Le toca girar la ruleta" className="ml-1 align-middle text-xs" aria-label="le toca girar">
                    🎡
                  </span>
                )}
              </span>
              <span className="font-display text-lg font-extrabold tabular-nums">{pts}</span>
            </li>
          );
        })}
      </ol>

      {results.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Letras jugadas</h3>
          <div className="flex flex-wrap gap-1.5">
            {results.map((r) => (
              <span key={r.round} className="grid h-8 w-8 place-items-center rounded-lg border border-line font-display font-extrabold">
                {r.letter}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-4 text-sm">
        {ownerId === me && (
          <button
            type="button"
            onClick={() => {
              if (confirm("¿Empezar una partida nueva? Se borran todos los puntos.")) onReset();
            }}
            className="text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Nueva partida
          </button>
        )}
        <button type="button" onClick={onLeave} className="text-muted underline-offset-4 hover:text-ink hover:underline">
          Cambiar nombre / salir
        </button>
      </div>
    </aside>
  );
}
