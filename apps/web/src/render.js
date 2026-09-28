import { formatEnvironment } from "common";

export function renderPage(environment = "demo") {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Stablehouse Web Demo</title></head>
  <body>
    <main>
      <h1>Stablehouse Web</h1>
      <p class="tagline">Chore release smoke test — follow-up commit</p>
      <p>Follow-up commit 3</p>
      <p>Environment: ${formatEnvironment(environment)}</p>
    </main>
  </body>
</html>
`;
}
