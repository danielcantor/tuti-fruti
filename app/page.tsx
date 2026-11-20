"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AnswerForm from "@/components/AnswerForm";
import Chat from "@/components/Chat";
import Finished from "@/components/Finished";
import Review from "@/components/Review";
import Scoreboard from "@/components/Scoreboard";
import Wheel from "@/components/Wheel";
import {
  type Answers,
  CATEGORIES,
  ROUND_OPTIONS,
  STOP_MS,
  effectiveBastaAt,
  emptyAnswers,
  roundDeadline,
} from "@/lib/game";
import { useGame } from "@/lib/useGame";

export default function Home() {
  const g = useGame();
  if (!g.ready) return null;
  if (!g.name) return <Join onJoin={g.join} />;
  return <Table g={g} />;
}

function Join({ onJoin }: { onJoin: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <form
        className="flex w-full max-w-sm flex-col gap-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          await onJoin(name);
          setBusy(false);
        }}
      >
        <div className="flex flex-col gap-3">
          <Logo className="text-5xl" />
          <p className="text-muted">
            Una letra, cinco categorías: {CATEGORIES.map((c) => c.label.toLowerCase()).join(", ")}. El primero que
            completa todo canta <strong className="text-ink">¡Basta!</strong>
          </p>
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">¿Cómo te llamás?</span>
          <input
            autoFocus
            value={name}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre"
            className="rounded-xl border border-line bg-card px-4 py-3 text-lg outline-none focus:border-ink"
          />
        </label>
        <button
          disabled={!name.trim() || busy}
          className="rounded-2xl bg-accent px-6 py-4 font-display text-xl font-extrabold text-accent-ink transition active:translate-y-px disabled:opacity-40"
        >
          Entrar a jugar
        </button>
      </form>
    </main>
  );
}

function Logo({ className = "" }: { className?: string }) {
  return (
    <h1 className={`font-display font-extrabold leading-none tracking-tight ${className}`}>
      Tuti<span className="text-accent">·</span>Fruti
    </h1>
  );
}

type G = ReturnType<typeof useGame>;

function Table({ g }: { g: G }) {
  const { state, game, phase, pid, send, now } = g;
  const me = pid!;
  const players = useMemo(() => state?.players ?? [], [state?.players]);
  const nameOf = useCallback(
    (id: string) => players.find((p) => p.id === id)?.name || "Alguien que se fue",
    [players],
  );

  // Borrador local de respuestas, sincronizado con el servidor con un pequeño retraso.
  const [draft, setDraft] = useState<Answers>(emptyAnswers());
  const [draftRound, setDraftRound] = useState(0);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(draft);

  if (state && game.round !== draftRound) {
    // Ronda nueva: empezar en blanco (o con lo que ya había guardado si recargó la página).
    setDraftRound(game.round);
    setDraft(state.answers[me] ?? emptyAnswers());
  }

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    send({ type: "answer", answers: latest.current });
  }, [send]);

  const onChange = (a: Answers) => {
    setDraft(a);
    latest.current = a;
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, phase === "stopping" ? 250 : 500);
  };

  useEffect(() => {
    if (phase === "review") flush();
  }, [phase, flush]);

  const spinning = phase === "spinning";
  const bastaAt = effectiveBastaAt(game, now);
  const countdown = bastaAt ? Math.max(0, Math.ceil((bastaAt + STOP_MS - now) / 1000)) : 0;
  const deadline = roundDeadline(game);
  const left = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
  const results = state?.results ?? [];
  const maxRounds = game.maxRounds ?? null;
  const started = results.length > 0;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 px-4 pt-6 pb-24 sm:px-6 lg:pt-10">
      <header className="flex items-center justify-between gap-4">
        <Logo className="text-3xl sm:text-4xl" />
        <div className="text-right text-sm text-muted">
          {game.round > 0 && (
            <div>
              Ronda {game.round}
              {maxRounds !== null && ` de ${maxRounds}`}
            </div>
          )}
          <div>
            Jugás como <span className="font-semibold text-ink">{g.name}</span>
          </div>
        </div>
      </header>

      {g.offline && (
        <p className="rounded-xl bg-accent-soft px-4 py-2 text-sm">Se cortó la conexión con el juego, reintentando…</p>
      )}

      <div className="grid flex-1 gap-6 lg:grid-cols-[1fr_20rem]">
        <main className="min-w-0">
          {(phase === "lobby" || spinning) && (
            <section className="flex flex-col items-center gap-6 py-2 text-center">
              <Wheel
                round={game.round}
                letter={game.letter}
                spinAt={game.spinAt}
                used={game.usedLetters}
                serverNow={g.serverNow}
                spinning={spinning}
              />
              {spinning ? (
                <p className="font-display text-2xl font-extrabold">Girando…</p>
              ) : (
                <>
                  <button
                    onClick={() => send({ type: "spin" })}
                    className="rounded-2xl bg-accent px-8 py-4 font-display text-2xl font-extrabold text-accent-ink shadow-[0_6px_0_0_rgba(0,0,0,0.18)] transition active:translate-y-1 active:shadow-none"
                  >
                    Girar la ruleta
                  </button>
                  {!started ? (
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-sm font-medium">¿Cuántas rondas?</span>
                      <div role="radiogroup" aria-label="Cantidad de rondas" className="flex flex-wrap justify-center gap-2">
                        {ROUND_OPTIONS.map((opt) => {
                          const active = opt === maxRounds;
                          return (
                            <button
                              key={String(opt)}
                              role="radio"
                              aria-checked={active}
                              onClick={() => !active && send({ type: "setMaxRounds", value: opt })}
                              className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                                active ? "border-ink bg-ink text-paper" : "border-line bg-card hover:border-ink"
                              }`}
                            >
                              {opt === null ? "Sin límite" : `${opt} rondas`}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm font-medium">
                      {maxRounds !== null
                        ? `Partida a ${maxRounds} rondas · faltan ${maxRounds - results.length}`
                        : "Partida sin límite · si nadie gira en 15 min, la partida termina"}
                    </p>
                  )}
                  <p className="max-w-md text-sm text-muted">
                    Cuando gira, la ronda arranca para todos los que están en la sala.
                    {players.length > 0 && (
                      <>
                        {" "}
                        En la sala: {players.map((p) => p.name).join(", ")}.
                      </>
                    )}
                  </p>
                </>
              )}
            </section>
          )}

          {(phase === "playing" || phase === "stopping") && game.letter && (
            <section className="flex flex-col gap-5">
              <div className="flex items-center gap-5">
                <div
                  key={game.round}
                  className="animate-pop grid h-24 w-24 shrink-0 place-items-center rounded-3xl bg-accent font-display text-6xl font-extrabold text-accent-ink sm:h-28 sm:w-28 sm:text-7xl"
                >
                  {game.letter}
                </div>
                <div className="flex-1">
                  <p className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">Todo con {game.letter}</p>
                  <p className="text-sm text-muted">Completá las 5 y cantá ¡Basta!</p>
                </div>
                {phase === "playing" && deadline && (
                  <span
                    title="Tiempo que queda de la ronda"
                    className={`rounded-xl border px-3 py-1.5 font-display text-xl font-extrabold tabular-nums ${
                      left <= 30 ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"
                    }`}
                  >
                    {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
                  </span>
                )}
              </div>

              {phase === "stopping" && (
                <div
                  role="status"
                  className="flex items-center justify-between gap-4 rounded-2xl bg-ink px-5 py-4 text-paper"
                >
                  <span className="font-display text-xl font-extrabold sm:text-2xl">
                    {!game.bastaBy
                      ? "¡Se acabó el tiempo!"
                      : game.bastaBy === me
                        ? "¡Basta! (lo cantaste vos)"
                        : `¡Basta! cantó ${nameOf(game.bastaBy)}`}
                  </span>
                  <span className="font-display text-4xl font-extrabold tabular-nums">{countdown}</span>
                </div>
              )}

              <AnswerForm
                letter={game.letter}
                answers={draft}
                onChange={onChange}
                stopping={phase === "stopping"}
                locked={false}
                onBasta={() => {
                  if (timer.current) clearTimeout(timer.current);
                  dirty.current = false;
                  send({ type: "basta", answers: draft });
                }}
              />
            </section>
          )}

          {phase === "finished" && (
            <Finished
              totals={{
                ...Object.fromEntries(players.map((p) => [p.id, 0])),
                ...(state?.totals ?? {}),
              }}
              results={results}
              rounds={results.length}
              byIdle={maxRounds === null}
              nameOf={nameOf}
              me={me}
              onRestart={() => send({ type: "reset" })}
            />
          )}

          {phase === "review" && state && (
            <Review
              letter={game.letter ?? ""}
              answers={state.answers}
              invalid={state.invalid}
              preview={state.preview ?? {}}
              nameOf={nameOf}
              me={me}
              onToggle={(target, cat) => send({ type: "toggleInvalid", target, cat })}
              onClose={() => send({ type: "closeRound" })}
            />
          )}
        </main>

        <Scoreboard
          players={players}
          totals={state?.totals ?? {}}
          results={state?.results ?? []}
          nameOf={nameOf}
          me={me}
          onReset={() => send({ type: "reset" })}
          onLeave={g.leave}
        />
      </div>

      <Chat messages={state?.chat ?? []} me={me} onSend={(text) => send({ type: "chat", text })} />

      {g.error && (
        <div
          role="alert"
          className="fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md sm:bottom-4 rounded-xl bg-ink px-4 py-3 text-center text-sm text-paper shadow-lg"
        >
          {g.error}
        </div>
      )}
    </div>
  );
}
