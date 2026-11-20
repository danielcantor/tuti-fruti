"use client";

import { type Answers, CATEGORIES, isComplete, startsWithLetter } from "@/lib/game";

type Props = {
  letter: string;
  answers: Answers;
  onChange: (a: Answers) => void;
  onBasta: () => void;
  locked: boolean;
  stopping: boolean;
};

export default function AnswerForm({ letter, answers, onChange, onBasta, locked, stopping }: Props) {
  const complete = isComplete(answers);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete && !stopping && !locked) onBasta();
      }}
    >
      {CATEGORIES.map(({ key, label }, i) => {
        const v = answers[key];
        const wrong = v.trim().length > 0 && !startsWithLetter(v, letter);
        return (
          <label key={key} className="group block">
            <span className="mb-1 flex items-baseline justify-between text-sm font-medium text-muted">
              {label}
              {wrong && <span className="text-xs text-accent">No empieza con {letter}</span>}
            </span>
            <input
              autoFocus={i === 0}
              disabled={locked}
              value={v}
              maxLength={60}
              autoComplete="off"
              autoCapitalize="words"
              spellCheck={false}
              placeholder={`${letter}…`}
              onChange={(e) => onChange({ ...answers, [key]: e.target.value })}
              className={`w-full rounded-xl border bg-card px-4 py-3 text-lg outline-none transition placeholder:text-muted/50 focus:border-ink disabled:opacity-60 ${
                wrong ? "border-accent" : "border-line"
              }`}
            />
          </label>
        );
      })}
      <button
        type="submit"
        disabled={!complete || stopping || locked}
        className="mt-2 rounded-2xl bg-accent px-6 py-4 font-display text-2xl font-extrabold tracking-tight text-accent-ink shadow-[0_6px_0_0_rgba(0,0,0,0.18)] transition active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:opacity-40"
      >
        {stopping ? "¡Basta! cantado" : complete ? "¡Basta!" : "Completá todo para cantar ¡Basta!"}
      </button>
    </form>
  );
}
