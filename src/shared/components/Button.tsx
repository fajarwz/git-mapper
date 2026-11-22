import type { ComponentPropsWithRef } from "react";

export enum ButtonVariant {
  Primary = "primary",
  Secondary = "secondary",
  Danger = "danger",
}

const BASE =
  "rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  [ButtonVariant.Primary]: "bg-primary text-white soft-shadow hover:brightness-110",
  [ButtonVariant.Secondary]: "border border-hairline bg-glass-strong text-ink hover:bg-hover-glass",
  [ButtonVariant.Danger]: "border border-danger/30 bg-danger/15 text-danger-ink hover:bg-danger/25",
};

interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
}

export function Button({ variant = ButtonVariant.Secondary, type = "button", className = "", ...rest }: ButtonProps) {
  return <button type={type} className={`${BASE} ${VARIANTS[variant]} ${className}`} {...rest} />;
}
