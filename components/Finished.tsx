"use client";

import { computeAwards } from "@/lib/awards";
import { type RoundResult, winners } from "@/lib/game";

type Props = {
  totals: Record<string, number>;
  results: RoundResult[];
  rounds: number;
  byIdle: boolean;
  nameOf: (id: string) => string;
  me: string;
  onRestart: () => void;
};

const MEDALS = ["🥇", "🥈", "🥉"];

export default function Finished({ totals, results, rounds, byIdle, nameOf, me, onRestart }: Props) {
  const awards = computeAwards(results);
  const top = winners(totals);
  const ranking = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  const podium = ranking.slice(0, 3);
  const names = top.map(nameOf);
  const title =
    top.length === 0
      ? "Terminó la partida"
      : top.length === 1
        ? `¡Ganó ${names[0]}!`
        : `Empate entre ${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;

  return (
    <section className="flex flex-col items-center gap-8 py-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="animate-pop text-6xl" aria-hidden>
          🏆
        </span>
        <h2 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">{title}</h2>
        <p className="text-muted">
          {byIdle
            ? `La partida se cerró sola porque nadie giró la ruleta en 15 minutos (${rounds} ${rounds === 1 ? "ronda" : "rondas"}).`
            : `Se jugaron las ${rounds} rondas.`}
          {top.includes(me) && " ¡Felicitaciones!"}
        </p>
      </div>

      {podium.length > 0 && (
        <ol className="flex w-full max-w-md flex-col gap-2">
          {podium.map((id, i) => (
            <li
              key={id}
              className={`flex items-center gap-4 rounded-2xl border px-5 py-3 text-left ${
                i === 0 ? "border-accent bg-accent-soft" : "border-line bg-card"
              }`}
            >
              <span className="text-2xl" aria-hidden>
                {MEDALS[i]}
              </span>
              <span className="flex-1 truncate font-semibold">
                {nameOf(id)}
                {id === me && <span className="ml-1 text-xs font-normal text-muted">(vos)</span>}
              </span>
              <span className="font-display text-2xl font-extrabold tabular-nums">{totals[id]}</span>
            </li>
          ))}
        </ol>
      )}

      {awards.length > 0 && (
        <div className="flex w-full flex-col gap-3 text-left">
          <h3 className="text-center font-display text-2xl font-extrabold tracking-tight">Los premios de la partida</h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {awards.map((a) => (
              <li key={a.key} className="flex gap-3 rounded-2xl border border-line bg-card p-4">
                <span className="text-3xl leading-none" aria-hidden>
                  {a.emoji}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">{a.title}</p>
                  <p className="break-words font-display text-xl font-extrabold">{a.value}</p>
                  {(a.detail || a.playerIds.length > 0) && (
                    <p className="text-sm text-muted">
                      {a.detail}
                      {a.detail && a.playerIds.length > 0 && " "}
                      {a.playerIds.length > 0 && (
                        <span className="font-semibold text-ink">{a.playerIds.map(nameOf).join(", ")}</span>
                      )}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onRestart}
        className="rounded-2xl bg-accent px-8 py-4 font-display text-2xl font-extrabold text-accent-ink shadow-[0_6px_0_0_rgba(0,0,0,0.18)] transition active:translate-y-1 active:shadow-none"
      >
        Jugar otra partida
      </button>
    </section>
  );
}
