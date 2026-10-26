import { BrandGlyph } from "./icons";

/**
 * Shown between the first React commit and the persisted repos landing. Without it App has no
 * repository yet, so the open-folder card renders for as long as the first git read takes and
 * reads as "nothing is saved". Fresh installs never see this: with no stored paths there is
 * nothing to wait for, so the empty state is the honest screen.
 */
export function BootScreen() {
  return (
    <div
      data-boot-screen
      role="status"
      aria-live="polite"
      className="grid min-h-0 flex-1 place-items-center"
    >
      <div className="flex flex-col items-center gap-3">
        <span className="grid place-items-center rounded-2xl bg-primary text-white soft-shadow size-12">
          <BrandGlyph width={26} height={26} />
        </span>
        <p className="m-0 text-[13px] font-semibold text-ink-dim">Opening your repositories…</p>
        <span aria-hidden="true" className="flex items-center gap-1.5">
          {[0, 1, 2].map((index) => (
            <i
              key={index}
              className="boot-dot size-1.5 rounded-full bg-primary"
              style={{ animationDelay: `${index * 140}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}
