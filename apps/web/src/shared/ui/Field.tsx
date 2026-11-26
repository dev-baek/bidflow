import type { ReactNode } from "react";

type ControlProps = {
  id: string;
  className: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

type FieldProps = Readonly<{
  id: string;
  label: string;
  description?: string;
  error?: string;
  children: (props: ControlProps) => ReactNode;
}>;

export function Field({ id, label, description, error, children }: FieldProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return <div className="ui-field">
    <label htmlFor={id}>{label}</label>
    {descriptionId && <p id={descriptionId} className="ui-field__description">{description}</p>}
    {children({
      id,
      className: "ui-field__control",
      "aria-describedby": [descriptionId, errorId].filter(Boolean).join(" ") || undefined,
      "aria-invalid": errorId ? true : undefined,
    })}
    {errorId && <p id={errorId} role="alert" className="ui-field__error">{error}</p>}
  </div>;
}
