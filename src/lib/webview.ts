/**
 * WebView2 ships a context menu whose "Reload" reloads the custom-protocol origin
 * (`http://tauri.localhost`), and that lands on Edge's "can't reach this page" error instead
 * of the app. Keyboard refresh hits the same wall. Both are dead ends in a bundled app, so
 * they are switched off — except the context menu in dev, where it is the way into Inspect.
 */
export function installWebviewGuards(): void {
  if (!import.meta.env.DEV) {
    document.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const refresh = key === "f5" || ((event.ctrlKey || event.metaKey) && key === "r");
    if (!refresh) return;
    event.preventDefault();
  });
}
