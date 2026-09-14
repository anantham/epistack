"use client";

import { useState } from "react";
import type { DeepDiveResult } from "../../lib/deep-dive";
import { overturnNoteLimit } from "../../lib/reject-overturn";

export type OverturnState = {
  status: "idle" | "saving" | "saved" | "error";
  error: string;
};

type RejectOverturnProps = {
  result: DeepDiveResult | null;
  passageFound: boolean;
  state: OverturnState;
  disabled: boolean;
  onOverturn: (note: string) => void;
};

export function RejectOverturn({ result, passageFound, state, disabled, onOverturn }: RejectOverturnProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const saving = state.status === "saving";

  if (state.status === "saved") {
    return <p className="reject-overturn-saved">Accepted by you as human-verified. It now counts as evidence in the Artifact.</p>;
  }
  if (!result) {
    return <p className="reject-overturn-blocked">Can&apos;t be overturned: the reviewer asked for a revision but gave no corrected result.</p>;
  }
  if (!passageFound) {
    return <p className="reject-overturn-blocked">Can&apos;t be overturned: the quoted passage wasn&apos;t found in the preserved full text.</p>;
  }

  return (
    <details className="reject-overturn">
      <summary>Review this reject</summary>
      <div>
        <div className="reject-overturn-result">
          <div>
            <span className={`relation-chip ${result.relation}`}>{result.relation}</span>
            <small>{result.claimFrameId} · {result.scopeMatch}</small>
          </div>
          <strong>{result.resultText}</strong>
          {result.estimate && <b>{result.estimate}</b>}
          <blockquote>“{result.exactExcerpt}”</blockquote>
          <small>{result.locator}</small>
        </div>
        <label className="human-promotion-check">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={disabled || saving}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>I read this passage in the full text and the reviewer&apos;s objection, and this result holds for the claim.</span>
        </label>
        <label className="reject-overturn-note">
          <span>Why the reviewer was wrong <small>optional · {note.length}/{overturnNoteLimit}</small></span>
          <textarea
            rows={2}
            maxLength={overturnNoteLimit}
            value={note}
            disabled={disabled || saving}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        {state.error && <p className="deep-dive-error" role="alert">{state.error}</p>}
        <div className="candidate-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => onOverturn(note.trim())}
            disabled={!confirmed || disabled || saving}
          >
            {saving ? "Re-checking the passage…" : "Accept as human-verified"}
          </button>
        </div>
      </div>
    </details>
  );
}
