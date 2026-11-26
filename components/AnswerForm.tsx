"use client";

import { ANSWER_MAX_LEN, type Answers, type CategoryKey, answerProblem, categoryLabel, isComplete } from "@/lib/game";

type Props = {
  letter: string;
  categories: CategoryKey[];
  answers: Answers;
  onChange: (a: Answers) => void;
  onBasta: () => void;
  locked: boolean;
  stopping: boolean;
};

export default function AnswerForm({ letter, categories, answers, onChange, onBasta, locked, stopping }: Props) {
  const complete = isComplete(answers, categories);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete && !stopping && !locked) onBasta();
      }}
    >
      {categories.map((key, i) => {
        const label = categoryLabel(key);
        const v = answers[key] ?? "";
        const problem = answerProblem(v, letter, key);
        const wrong = problem !== null;
        return (
          <label key={key} className="group block">
            <span className="mb-1 flex items-baseline justify-between text-sm font-medium text-muted">
              {label}
              {wrong && <span className="text-xs text-accent">{problem}</span>}
            </span>
            <input
              autoFocus={i === 0}
              disabled={locked}
              value={v}
              maxLength={ANSWER_MAX_LEN}
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
