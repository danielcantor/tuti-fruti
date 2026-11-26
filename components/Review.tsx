"use client";

import {
  type Answers,
  type CategoryKey,
  type Votes,
  CATEGORIES,
  answerProblem,
  invalidKey,
} from "@/lib/game";

type Vote = "si" | "no" | null;

type Props = {
  letter: string;
  answers: Record<string, Answers>;
  invalid: string[];
  votes: Votes;
  preview: Record<string, Partial<Record<CategoryKey, number>>>;
  /** Jugadores conectados, en orden de llegada (para saber a quién le falta votar). */
  online: string[];
  nameOf: (id: string) => string;
  me: string;
  onVote: (target: string, cat: CategoryKey, value: Vote) => void;
  onClose: () => void;
  isOwner: boolean;
  ownerName: string;
};

const badge = (p: number) =>
  p === 10 ? "bg-ok/15 text-ok" : p === 5 ? "bg-accent-soft text-ink" : "bg-line text-muted";

const labelOf = (cat: CategoryKey) => CATEGORIES.find((c) => c.key === cat)?.label ?? cat;
const anchor = (id: string, cat: CategoryKey) => `voto-${id}-${cat}`;
const list = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;

export default function Review({
  letter,
  answers,
  invalid,
  votes,
  preview,
  online,
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

  const tally = (key: string) => {
    const byVoter = votes[key] ?? {};
    const author = key.split("|")[0];
    const no = Object.keys(byVoter).filter((v) => v !== author && !byVoter[v]);
    const yes = Object.keys(byVoter).filter((v) => v !== author && byVoter[v]);
    return { no, yes, mine: byVoter[me] === undefined ? null : byVoter[me] ? "si" : "no" };
  };

  // Votaciones abiertas, en el orden de la tabla.
  const open = ids.flatMap((id) =>
    CATEGORIES.filter(({ key }) => votes[invalidKey(id, key)]).map(({ key }) => ({ id, cat: key })),
  );

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
          ¿Alguna no vale? Tocala para llevarla a votación. Se anula si hay más votos de «no vale» que de «vale»; si
          empatan, queda. Quien la escribió no vota.
        </p>
      </div>

      {ids.length === 0 ? (
        <p className="rounded-xl border border-line bg-card p-6 text-muted">Nadie mandó respuestas en esta ronda.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Jugador</th>
                {CATEGORIES.map((c) => (
                  <th key={c.key} className="px-2 py-2 font-medium">
                    {c.label}
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
                  {CATEGORIES.map(({ key }) => {
                    const text = answers[id]?.[key]?.trim() ?? "";
                    const k = invalidKey(id, key);
                    const isInv = inv.has(k);
                    const p = preview[id]?.[key] ?? 0;
                    const problem = text ? answerProblem(text, letter, key) : null;
                    const disputed = !!votes[k];
                    const t = disputed ? tally(k) : null;
                    const canAct = !!text && !problem && (disputed || id !== me);
                    return (
                      <td key={key} className="border-t border-line px-1 py-2">
                        <button
                          type="button"
                          disabled={!canAct}
                          onClick={() => onCell(id, key)}
                          title={
                            problem ??
                            (disputed ? "Ver la votación" : id === me ? "Es tu respuesta" : "Llevar a votación")
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
                                En votación · {t.no.length} no, {t.yes.length} sí
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

      {open.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="font-display text-xl font-extrabold tracking-tight">
            Votaciones <span className="text-muted">({open.length})</span>
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {open.map(({ id, cat }) => {
              const k = invalidKey(id, cat);
              const { no, yes, mine } = tally(k);
              const annulled = inv.has(k);
              const pending = online.filter((v) => v !== id && !no.includes(v) && !yes.includes(v));
              const isAuthor = id === me;
              const vote = (v: "si" | "no") => onVote(id, cat, mine === v ? null : v);
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
                        {isAuthor && " (vos)"} · {labelOf(cat)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                        annulled ? "bg-accent text-accent-ink" : "bg-ok/15 text-ok"
                      }`}
                    >
                      {annulled ? "Anulada" : "Vale"}
                    </span>
                  </div>

                  <dl className="grid gap-1 text-sm">
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 font-semibold">No vale ({no.length})</dt>
                      <dd className="text-muted">{no.length ? list(no.map(nameOf)) : "—"}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 font-semibold">Vale ({yes.length})</dt>
                      <dd className="text-muted">{yes.length ? list(yes.map(nameOf)) : "—"}</dd>
                    </div>
                    {pending.length > 0 && (
                      <div className="flex gap-2">
                        <dt className="w-20 shrink-0 font-semibold">Faltan</dt>
                        <dd className="text-muted">{list(pending.map(nameOf))}</dd>
                      </div>
                    )}
                  </dl>

                  {isAuthor ? (
                    <p className="text-sm text-muted">Es tu respuesta: no votás en esta.</p>
                  ) : (
                    <div className="flex gap-2" role="group" aria-label="Tu voto">
                      {(["si", "no"] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          aria-pressed={mine === v}
                          onClick={() => vote(v)}
                          className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition active:translate-y-px ${
                            mine === v
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
            className="rounded-2xl bg-ink px-6 py-3 font-semibold text-paper transition hover:opacity-90 active:translate-y-px"
          >
            Sumar puntos y volver a la ruleta
          </button>
          {open.length > 0 && (
            <p className="text-sm text-muted">Las votaciones se cierran con el resultado que tengan en ese momento.</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">Esperando que {ownerName} sume los puntos y vuelva a la ruleta…</p>
      )}
    </section>
  );
}
