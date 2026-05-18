"use client";

import { useState } from "react";
import { CANDIDATE_EVIDENCE_HASH, TRUSTED_TWIN_CASE_ID, TRILINGUAL_COPY, type TrilingualLanguage } from "./trusted-twin-data";

const LANGUAGES: TrilingualLanguage[] = ["zh", "en", "fr"];

export default function TrilingualSeal() {
  const [language, setLanguage] = useState<TrilingualLanguage>("zh");
  const copy = TRILINGUAL_COPY[language];

  return (
    <section className="twin-panel twin-trilingual">
      <div className="twin-section-heading">
        <span>Trilingual certificate draft</span>
        <strong>{copy.label}</strong>
      </div>
      <div className="twin-language-switcher" role="tablist" aria-label="Certificate language">
        {LANGUAGES.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={language === item} onClick={() => setLanguage(item)}>
            {TRILINGUAL_COPY[item].label}
          </button>
        ))}
      </div>
      <article className="twin-certificate-paper">
        <span>{copy.subtitle}</span>
        <h3>{copy.title}</h3>
        <p>{copy.body}</p>
        <dl className="twin-fact-list">
          <div>
            <dt>Case</dt>
            <dd>{TRUSTED_TWIN_CASE_ID}</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>{CANDIDATE_EVIDENCE_HASH}</dd>
          </div>
          <div>
            <dt>Effect</dt>
            <dd>{copy.effect}</dd>
          </div>
        </dl>
      </article>
    </section>
  );
}

