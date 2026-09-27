// The user guide at /guide: step-by-step help for the GM and for players. The words
// live in ../guide.ts, so they can be kept up to date without touching the layout.

import { useEffect } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { GUIDE } from "../guide";
import type { GuideSection } from "../guide";
import { Logo } from "./Logo";

const AUDIENCE: Record<GuideSection["audience"], string> = {
  gm: "For the GM",
  player: "For players",
  everyone: "For everyone",
};

/** Text with **bold** (UI labels) and `code` (things to type) marked up. */
function Rich(props: { text: string }): ComponentChildren {
  const out: ComponentChildren[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(props.text))) {
    if (m.index > last) out.push(props.text.slice(last, m.index));
    out.push(m[1] !== undefined ? <strong key={m.index}>{m[1]}</strong> : <code key={m.index}>{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < props.text.length) out.push(props.text.slice(last));
  return <>{out}</>;
}

export function GuidePage() {
  useEffect(() => {
    document.title = "Guide · Tabletop";
    // Arriving on /guide#fog: the section exists only after the first render.
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, []);

  return (
    <div class="guide-page">
      <header class="guide-head">
        <a href="/" class="guide-brand" aria-label="Tabletop start page">
          <Logo size={32} />
          <span>Tabletop</span>
        </a>
        <h1>How to use Tabletop</h1>
        <p class="muted">
          Step by step, for the players at the table and the GM running it. Players: start with{" "}
          <a href="#joining-a-game">Joining a game</a>. The sections marked "For everyone" cover the rest of what you'll use.
        </p>
      </header>

      <nav class="guide-toc card" aria-label="Contents">
        <h2>Contents</h2>
        <ol>
          {GUIDE.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.title}</a>
              <span class={`guide-tag ${s.audience}`}>{AUDIENCE[s.audience]}</span>
            </li>
          ))}
        </ol>
      </nav>

      {GUIDE.map((s) => (
        <section key={s.id} id={s.id} class="guide-section">
          <div class="guide-section-head">
            <h2>{s.title}</h2>
            <span class={`guide-tag ${s.audience}`}>{AUDIENCE[s.audience]}</span>
          </div>
          <p>
            <Rich text={s.intro} />
          </p>
          {s.parts.map((p) => (
            <div key={p.title} class="guide-part">
              <h3>{p.title}</h3>
              {p.steps.length > 0 && (
                <ol class="guide-steps">
                  {p.steps.map((step, i) => (
                    <li key={i}>
                      <Rich text={step} />
                    </li>
                  ))}
                </ol>
              )}
              {p.notes.length > 0 && (
                <ul class="guide-notes">
                  {p.notes.map((n, i) => (
                    <li key={i}>
                      <Rich text={n} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <a class="guide-top small" href="#">
            Back to the top
          </a>
        </section>
      ))}
    </div>
  );
}
