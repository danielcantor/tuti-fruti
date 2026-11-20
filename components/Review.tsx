"use client";

import { type Answers, type CategoryKey, CATEGORIES, answerProblem, invalidKey } from "@/lib/game";

type Props = {
  letter: string;
  answers: Record<string, Answers>;
  invalid: string[];
  preview: Record<string, Partial<Record<CategoryKey, number>>>;
  nameOf: (id: string) => string;
  me: string;
  onToggle: (target: string, cat: CategoryKey) => void;
  onClose: () => void;
  isOwner: boolean;
  ownerName: string;
};

const badge = (p: number) =>
  p === 10 ? "bg-ok/15 text-ok" : p === 5 ? "bg-accent-soft text-ink" : "bg-line text-muted";

export default function Review({
  letter,
  answers,
  invalid,
  preview,
  nameOf,
  me,
  onToggle,
  onClose,
  isOwner,
  ownerName,
}: Props) {
  const ids = Object.keys(answers);
  const inv = new Set(invalid);
  const sum = (id: string) => Object.values(preview[id] ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  ids.sort((a, b) => sum(b) - sum(a));

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-3xl font-extrabold tracking-tight">Revisión de la letra {letter}</h2>
        <p className="mt-1 text-sm text-muted">
          Tocá una respuesta que no vale para anularla (se anula para todos). Tocala de nuevo para devolverla.
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
                    const isInv = inv.has(invalidKey(id, key));
                    const p = preview[id]?.[key] ?? 0;
                    const problem = text ? answerProblem(text, letter, key) : null;
                    return (
                      <td key={key} className="border-t border-line px-1 py-2">
                        <button
                          type="button"
                          disabled={!text}
                          onClick={() => onToggle(id, key)}
                          title={problem ?? (isInv ? "Devolver respuesta" : "Anular respuesta")}
                          className="group flex w-full items-start justify-between gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-card disabled:cursor-default"
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className={`break-words ${isInv ? "text-muted line-through" : ""} ${!text ? "text-muted" : ""}`}>
                              {text || "—"}
                            </span>
                            {problem && <span className="text-[0.7rem] leading-tight text-accent">{problem}</span>}
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

      {isOwner ? (
        <button
          type="button"
          onClick={onClose}
          className="self-start rounded-2xl bg-ink px-6 py-3 font-semibold text-paper transition hover:opacity-90 active:translate-y-px"
        >
          Sumar puntos y volver a la ruleta
        </button>
      ) : (
        <p className="text-sm text-muted">Esperando que {ownerName} sume los puntos y vuelva a la ruleta…</p>
      )}
    </section>
  );
}
