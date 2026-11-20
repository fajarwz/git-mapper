// Records the showcase clips by driving the real app (needs `npm run dev` in the repo root on :1420).
// Usage: node scripts/record.mjs [scene ...]   (no names = every scene)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CLIPS, demoRepo, git, record, tinyRepo } from "./record/lib.mjs";

const commit = (page, subject) => page.getByRole("button", { name: new RegExp(`^${subject}`) });

const SCENES = {
  history: () =>
    record("history", {
      setup: () => ({ repos: [demoRepo()] }),
      scene: async (a) => {
        const { page } = a;
        await a.click(commit(page, "Merge fix/port into main"));
        await a.hold(300);
        await a.click(commit(page, "Brighten the accent"));
        await a.hold(300);
        await a.click(commit(page, "Merge feature/search into main"));
        await a.hold(300);
        await a.click(commit(page, "Add token auth"));
        await a.hold(300);
        await a.wheel(260);
        await a.click(commit(page, "Add job queue"));
        await a.hold(600);
      },
    }),

  diffs: () =>
    record("diffs", {
      setup: () => ({ repos: [demoRepo()] }),
      scene: async (a) => {
        const { page } = a;
        await a.click(commit(page, "Read the port from the environment"));
        await a.hold(700);
        await a.click(page.getByRole("button", { name: "Split", exact: true }));
        await a.hold(600);
        await a.click(commit(page, "Make search case-insensitive"));
        await a.hold(600);
        await a.click(commit(page, "Initial commit"));
        await a.hold(300);
        await a.click(page.getByRole("button", { name: "All files" }));
        await a.hold(800);
        await a.wheel(300);
        await a.hold(600);
      },
    }),
};

Object.assign(SCENES, {
  stage: () =>
    record("stage", {
      setup: () => ({ repos: [demoRepo()] }),
      scene: async (a) => {
        const { page } = a;
        await a.click(page.getByText("server.ts").first());
        await a.hold(300);
        await a.click(page.getByLabel(/^Pick/).nth(0), { after: 150 });
        await a.click(page.getByLabel(/^Pick/).nth(1));
        await a.hold(300);
        await a.click(page.getByRole("button", { name: /^Stage [+−-]/ }));
        await a.hold(300);
        await a.click(page.getByRole("button", { name: /^Stage metrics\.ts/ }));
        await a.hold(300);
        await a.click(page.getByLabel("Commit message"));
        await a.type("Listen on 8080 and expose metrics", 55);
        await a.press(["Ctrl", "Enter"], "Control+Enter", { after: 1200 });
      },
    }),

  conflict: () =>
    record("conflict", {
      setup: () => {
        const dir = demoRepo();
        try {
          git(dir, "merge", "feature/dark-theme");
        } catch {
          /* the conflict is the point */
        }
        return { repos: [dir] };
      },
      scene: async (a) => {
        const { page } = a;
        await a.click(page.getByText("theme.ts").first());
        await a.hold(600);
        await a.click(page.getByRole("button", { name: "Keep incoming" }));
        await a.hold(700);
        await a.click(page.getByRole("button", { name: "Complete merge" }));
        await a.hold(1200);
      },
    }),
});

Object.assign(SCENES, {
  switcher: () =>
    record("switcher", {
      setup: () => ({ repos: [demoRepo(), tinyRepo("atlas", ["Seed the map", "Add tiles"]), tinyRepo("relay", ["Start relay", "Add retries", "Batch sends"])] }),
      scene: async (a) => {
        const { page } = a;
        await a.moveTo(900, 420, 400);
        await a.press(["Ctrl", "P"], "Control+p", { after: 900, badge: 2400 });
        await a.type("rel", 140);
        await a.hold(700);
        await a.press(["Enter"], "Enter", { after: 1300, badge: 900 });
      },
    }),

  findbar: () =>
    record("findbar", {
      setup: () => ({ repos: [demoRepo()] }),
      scene: async (a) => {
        await a.moveTo(900, 420, 400);
        await a.press(["Ctrl", "F"], "Control+f", { after: 700, badge: 2000 });
        await a.type("search", 130);
        await a.hold(600);
        await a.press(["Enter"], "Enter", { after: 800, badge: 800 });
        await a.press(["Enter"], "Enter", { after: 1000, badge: 800 });
      },
    }),

  branchmenu: () =>
    record("branchmenu", {
      setup: () => ({ repos: [demoRepo()] }),
      scene: async (a) => {
        const { page } = a;
        await a.rightClick(page.getByText("feature/auth", { exact: true }).first());
        await a.hold(700);
        await a.point(page.getByText(/Create pull request/).first(), { ms: 500 });
        await a.hold(1500);
      },
    }),

  settings: () =>
    record("settings", {
      setup: () => ({ repos: [demoRepo()] }),
      scene: async (a) => {
        const { page } = a;
        await a.click(page.getByRole("button", { name: "Open settings" }));
        await a.hold(600);
        await a.click(page.getByRole("button", { name: /Keyboard shortcuts/ }));
        await a.hold(600);
        await a.wheel(520, 14, 55);
        await a.hold(500);
        await a.wheel(-520, 12, 45);
        await a.hold(300);
        // Hover only: point at the GitHub syntax scheme without picking it.
        await a.point(page.getByRole("group", { name: "Syntax colours" }).getByRole("button", { name: /GitHub/ }));
        await a.hold(1500);
      },
    }),
});
const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(SCENES);
const manifestPath = join(CLIPS, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
for (const name of names) {
  if (!SCENES[name]) throw new Error(`unknown scene ${name}; known: ${Object.keys(SCENES).join(", ")}`);
  const { frames, events } = await SCENES[name]();
  manifest[name] = { frames, events };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}
void git;
void tinyRepo;
