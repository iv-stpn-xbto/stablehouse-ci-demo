export function formatEnvironment(environment) {
  const normalized = String(environment).trim().toLowerCase();

  if (!["demo", "production"].includes(normalized)) {
    throw new TypeError(`Unsupported environment: ${environment}`);
  }

  return normalized === "production" ? "Production" : "Demo";
}
