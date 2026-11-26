"use client";

import {
  type Answers,
  type CategoryKey,
  type VoteTally,
  MARK_MS,
  VOTE_MS,
  answerProblem,
  categoryLabel,
  invalidKey,
  voteClosed,
} from "@/lib/game";

type Vote = "si" | "no" | null;

type Props = {
  letter: string;
  categories: CategoryKey[];
  answers: Record<string, Answers>;
  invalid: string[];
  votes: Record<string, VoteTally>;
  preview: Record<string, Partial<Record<CategoryKey, number>>>;
  /** Hora del servidor, para la cuenta regresiva de las votaciones. */
  now: number;
  /** Hasta cuándo se pueden marcar palabras para votar. */
  markUntil: number | null;
  nameOf: (id: string) => string;
  me: string;
  onVote: (target: string, cat: CategoryKey, value: Vote) => void;
  onClose: () => void;
  isOwner: boolean;
  ownerName: string;
};

const badge = (p: number) =>
  p === 10 ? "bg-ok/15 text-ok" : p === 5 ? "bg-accent-soft text-ink" : "bg-line text-muted";

const anchor = (id: string, cat: CategoryKey) => `voto-${id}-${cat}`;
const people = (n: number) => (n === 1 ? "1 persona" : `${n} personas`);

export default function Review({
  letter,
  categories,
  answers,
  invalid,
  votes,
  preview,
  now,
  markUntil,
  nameOf,
  me,
  onVote,
  onClose,
  isOwner,
  ownerName,
}: Props) {
  const ids = Object.keys(answers);
  const inv = new Set(invalid);
  const sum = (id: string) => Object.values(preview[id] ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  ids.sort((a, b) => sum(b) - sum(a));

  // Votaciones abiertas, en el orden de la tabla.
  const disputes = ids.flatMap((id) =>
    categories.filter((key) => votes[invalidKey(id, key)]).map((key) => ({ id, cat: key })),
  );
  const running = Object.values(votes).filter((t) => !voteClosed(t, now));
  const waitSecs = running.length ? Math.max(1, Math.ceil((Math.max(...running.map((t) => t.endsAt)) - now) / 1000)) : 0;

  const markLeft = markUntil === null ? 0 : Math.max(0, markUntil - now);
  const canMark = markLeft > 0;

  const onCell = (id: string, cat: CategoryKey) => {
    if (votes[invalidKey(id, cat)]) {
      document.getElementById(anchor(id, cat))?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      onVote(id, cat, "no");
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-3xl font-extrabold tracking-tight">Revisión de la letra {letter}</h2>
        <p className="mt-1 text-sm text-muted">
          ¿Alguna no vale? Tocala para llevarla a votación (en los primeros {MARK_MS / 1000} segundos). El voto es
          anónimo y cada votación dura {VOTE_MS / 1000} segundos. Se anula si hay más votos de «no vale» que de
          «vale»; si empatan, queda. Quien la escribió no vota.
        </p>
        {canMark ? (
          <div className="mt-3 flex max-w-sm flex-col gap-1" data-testid="mark-window">
            <p className="text-sm font-semibold">
              Podés marcar palabras durante <span className="tabular-nums">{Math.ceil(markLeft / 1000)}</span> s
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
              <div
                className="h-full rounded-full bg-ink transition-[width] duration-200 ease-linear"
                style={{ width: `${(markLeft / MARK_MS) * 100}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm font-semibold text-muted" data-testid="mark-window">
            Ya no se pueden marcar más palabras.
          </p>
        )}
      </div>

      {ids.length === 0 ? (
        <p className="rounded-xl border border-line bg-card p-6 text-muted">Nadie mandó respuestas en esta ronda.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table
            className="w-full border-separate border-spacing-0 text-left"
            style={{ minWidth: 200 + categories.length * 110 }}
          >
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Jugador</th>
                {categories.map((key) => (
                  <th key={key} className="px-2 py-2 font-medium">
                    {categoryLabel(key)}
                  </th>
                ))}
                <th className="py-2 pl-2 text-right font-medium">Ronda</th>
              </tr>
            </thead>
            <tbody>
              {ids.map((id) => (
                <tr key={id} className="align-top">
                  <td className="border-t border-line py-3 pr-3 font-semibold">
                    {nameOf(id)}
                    {id === me && <span className="ml-1 text-xs font-normal text-muted">(vos)</span>}
                  </td>
                  {categories.map((key) => {
                    const text = answers[id]?.[key]?.trim() ?? "";
                    const k = invalidKey(id, key);
                    const isInv = inv.has(k);
                    const p = preview[id]?.[key] ?? 0;
                    const problem = text ? answerProblem(text, letter, key) : null;
                    const disputed = !!votes[k];
                    const t = votes[k];
                    const canAct = !!text && !problem && (disputed || (id !== me && canMark));
                    return (
                      <td key={key} className="border-t border-line px-1 py-2">
                        <button
                          type="button"
                          disabled={!canAct}
                          onClick={() => onCell(id, key)}
                          title={
                            problem ??
                            (disputed
                              ? "Ver la votación"
                              : id === me
                                ? "Es tu respuesta"
                                : canMark
                                  ? "Llevar a votación"
                                  : "Ya pasó el tiempo para marcar palabras")
                          }
                          className="group flex w-full items-start justify-between gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-card disabled:cursor-default disabled:hover:bg-transparent"
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className={`break-words ${isInv ? "text-muted line-through" : ""} ${!text ? "text-muted" : ""}`}>
                              {text || "—"}
                            </span>
                            {problem && <span className="text-[0.7rem] leading-tight text-accent">{problem}</span>}
                            {t && (
                              <span className={`text-[0.7rem] leading-tight ${isInv ? "text-accent" : "text-muted"}`}>
                                {voteClosed(t, now) ? "Votada" : "En votación"} · {t.no} no, {t.yes} sí
                              </span>
                            )}
                          </span>
                          <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${badge(p)}`}>
                            {p}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                  <td className="border-t border-line py-3 pl-2 text-right font-display text-xl font-extrabold tabular-nums">
                    {sum(id)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {disputes.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="font-display text-xl font-extrabold tracking-tight">
            Votaciones <span className="text-muted">({disputes.length})</span>
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {disputes.map(({ id, cat }) => {
              const k = invalidKey(id, cat);
              const t = votes[k];
              const closed = voteClosed(t, now);
              const left = Math.max(0, t.endsAt - now);
              const annulled = inv.has(k);
              const isAuthor = id === me;
              const vote = (v: "si" | "no") => onVote(id, cat, t.mine === v ? null : v);
              return (
                <li
                  key={k}
                  id={anchor(id, cat)}
                  className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4"
                  data-vote={k}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-display text-lg font-extrabold leading-tight">
                        «{answers[id]?.[cat]?.trim()}»
                      </p>
                      <p className="text-sm text-muted">
                        {nameOf(id)}
                        {isAuthor && " (vos)"} · {categoryLabel(cat)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                        annulled ? "bg-accent text-accent-ink" : "bg-ok/15 text-ok"
                      }`}
                    >
                      {closed ? (annulled ? "Anulada" : "Vale") : annulled ? "Por ahora no vale" : "Por ahora vale"}
                    </span>
                  </div>

                  <p className="flex gap-4 text-sm">
                    <span>
                      <strong className="tabular-nums">{t.no}</strong> no vale
                    </span>
                    <span>
                      <strong className="tabular-nums">{t.yes}</strong> vale
                    </span>
                    {!closed && t.pending > 0 && (
                      <span className="text-muted">Faltan votar {people(t.pending)}</span>
                    )}
                  </p>

                  {closed ? (
                    <p className="text-sm text-muted">
                      Votación cerrada{t.done && left > 0 ? ": ya votaron todos" : ""}.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
                        <div
                          className="h-full rounded-full bg-accent transition-[width] duration-200 ease-linear"
                          style={{ width: `${(left / VOTE_MS) * 100}%` }}
                        />
                      </div>
                      <p className="text-xs tabular-nums text-muted">Quedan {Math.ceil(left / 1000)} s</p>
                    </div>
                  )}

                  {!closed &&
                    (isAuthor ? (
                      <p className="text-sm text-muted">Es tu respuesta: no votás en esta.</p>
                    ) : (
                      <div className="flex gap-2" role="group" aria-label="Tu voto">
                        {(["si", "no"] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            aria-pressed={t.mine === v}
                            onClick={() => vote(v)}
                            className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition active:translate-y-px ${
                              t.mine === v
                                ? v === "si"
                                  ? "border-ok bg-ok text-paper"
                                  : "border-accent bg-accent text-accent-ink"
                                : "border-line hover:border-ink"
                            }`}
                          >
                            {v === "si" ? "Vale" : "No vale"}
                          </button>
                        ))}
                      </div>
                    ))}
                  {closed && t.mine && (
                    <p className="text-xs text-muted">Votaste «{t.mine === "si" ? "vale" : "no vale"}».</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {isOwner ? (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={running.length > 0}
            className="rounded-2xl bg-ink px-6 py-3 font-semibold text-paper transition hover:opacity-90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
          >
            Sumar puntos y volver a la ruleta
          </button>
          {running.length > 0 && (
            <p className="text-sm text-muted">
              Hay {running.length === 1 ? "una votación" : `${running.length} votaciones`} en curso. Podés seguir en{" "}
              <span className="tabular-nums">{waitSecs}</span> s.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">Esperando que {ownerName} sume los puntos y vuelva a la ruleta…</p>
      )}
    </section>
  );
}
