type ActionStepProps = {
  index: number;
  title: string;
  detail: string;
  kind: "power" | "card" | "attack";
};

function ActionIcon({ kind }: Pick<ActionStepProps, "kind">) {
  if (kind === "card") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m8 5 10 4-4 10-10-4L8 5Z" />
        <path d="m10.5 9 4 1.6" />
      </svg>
    );
  }

  if (kind === "attack") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="7" />
        <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m14.5 3-7 10h5l-3 8 8-11h-5l2-7Z" />
    </svg>
  );
}

export function ActionStep({ index, title, detail, kind }: ActionStepProps) {
  return (
    <li className="action-step">
      <span className="step-index">{index}</span>
      <span className="step-line" aria-hidden="true" />
      <span className="step-icon">
        <ActionIcon kind={kind} />
      </span>
      <span className="step-copy">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </li>
  );
}
