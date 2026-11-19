import { splitByTokens } from "../lib/commitFilter";

/** `text` with the stretches a find matched painted as a highlight; plain text without terms. */
export function Marked({ text, terms }: { text: string; terms?: string[] }) {
  if (!terms || terms.length === 0) return <>{text}</>;
  return (
    <>
      {splitByTokens(text, terms).map((part, index) =>
        part.hit ? (
          <mark key={index} className="rounded-xs bg-primary/35 px-px text-inherit">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
