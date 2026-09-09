import { formatEnvironment } from "common";

export function renderPage(environment = "demo") {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Stablehouse Web</title></head>
  <body>
    <main>
      <h1>Stablehouse Web</h1>
      <p>Environment: ${formatEnvironment(environment)}</p>
    </main>
  </body>
</html>
`;
}
