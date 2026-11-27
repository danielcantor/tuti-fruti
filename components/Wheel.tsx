"use client";

import { useEffect, useRef, useState } from "react";
import { LETTERS, SPIN_MS } from "@/lib/game";

const N = LETTERS.length;
const SEG = 360 / N;
const R = 150;
const C = 160;

function arc(i: number) {
  const a0 = ((i * SEG - 90) * Math.PI) / 180;
  const a1 = (((i + 1) * SEG - 90) * Math.PI) / 180;
  const p = (a: number) => `${C + R * Math.cos(a)} ${C + R * Math.sin(a)}`;
  return `M ${C} ${C} L ${p(a0)} A ${R} ${R} 0 0 1 ${p(a1)} Z`;
}

type Props = {
  round: number;
  letter: string | null;
  spinAt: number | null;
  used: string[];
  serverNow: () => number;
  spinning: boolean;
};

export default function Wheel({ round, letter, spinAt, used, serverNow, spinning }: Props) {
  const [rot, setRot] = useState(0);
  const [dur, setDur] = useState(0);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!letter || last.current === round) return;
    last.current = round;
    const idx = LETTERS.indexOf(letter);
    const target = (((360 - (idx + 0.5) * SEG) % 360) + 360) % 360;
    const remaining = spinAt ? spinAt + SPIN_MS - serverNow() : 0;
    const animate = spinning && remaining > 400;
    // Arranca en el próximo frame para que la transición se aplique.
    const id = requestAnimationFrame(() => {
      setDur(animate ? remaining : 0);
      setRot((prev) => {
        const base = prev - (((prev % 360) + 360) % 360);
        return base + target + (animate ? 360 * 6 : 0);
      });
    });
    return () => cancelAnimationFrame(id);
  }, [round, letter, spinAt, serverNow, spinning]);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[22rem]">
      <svg viewBox="0 0 320 320" className="h-full w-full drop-shadow-[0_10px_30px_rgba(0,0,0,0.12)]" aria-hidden>
        <g
          style={{
            transform: `rotate(${rot}deg)`,
            transformOrigin: "160px 160px",
            transition: dur ? `transform ${dur}ms cubic-bezier(0.12, 0.62, 0.08, 1)` : "none",
          }}
        >
          {LETTERS.map((l, i) => {
            // Con una cantidad impar de letras, la última tiene otro color para no
            // quedar pegada a la primera con el mismo tono.
            const odd = N % 2 === 1 && i === N - 1;
            const dark = !odd && i % 2 === 0;
            const isUsed = used.includes(l) && !(l === letter && !spinning);
            const mid = i * SEG + SEG / 2;
            return (
              <g key={l}>
                <path
                  d={arc(i)}
                  fill={odd ? "var(--accent-soft)" : dark ? "var(--wheel-a)" : "var(--wheel-b)"}
                  stroke="var(--paper)"
                  strokeWidth="1.5"
                />
                <text
                  x={C}
                  y={C - R + 26}
                  transform={`rotate(${mid} ${C} ${C})`}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="font-display"
                  style={{ fontSize: 20, fontWeight: 800 }}
                  fill={dark ? "var(--wheel-b)" : "var(--wheel-a)"}
                  opacity={isUsed ? 0.28 : 1}
                >
                  {l}
                </text>
              </g>
            );
          })}
        </g>
        <circle cx={C} cy={C} r="34" fill="var(--accent)" stroke="var(--paper)" strokeWidth="4" />
        <path d="M160 2 L174 30 L146 30 Z" fill="var(--accent)" stroke="var(--paper)" strokeWidth="3" strokeLinejoin="round" />
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <span className="font-display text-3xl font-extrabold text-accent-ink">
          {!spinning && letter ? letter : "?"}
        </span>
      </div>
      <span className="sr-only" aria-live="polite">
        {spinning ? "Girando la ruleta" : letter ? `Salió la letra ${letter}` : ""}
      </span>
    </div>
  );
}
