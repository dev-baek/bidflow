import type { ComponentProps } from "react";

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  pendingLabel?: string;
};

export function Button({
  variant = "primary", size = "md", type = "button", pendingLabel, disabled,
  className, children, ...props
}: ButtonProps) {
  const pending = pendingLabel !== undefined;
  return <button
    {...props}
    type={type}
    className={["ui-button", `ui-button--${variant}`, `ui-button--${size}`, className].filter(Boolean).join(" ")}
    disabled={disabled || pending}
    aria-busy={pending || props["aria-busy"]}
  >{pendingLabel ?? children}</button>;
}
