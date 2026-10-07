// Planning assumptions, not an account quote. Sources and exclusions: docs/DEPLOYMENT.md.
const hours = 730;
for (const [stage, tasks, nat, databaseAllowance, operationsAllowance, waf] of [
  ["staging", 2, 1, 30, 20, 0], ["production", 3, 2, 130, 40, 8.6],
]) {
  const rows = {
    fargate: tasks * hours * (0.5 * 0.000011244 * 3600 + 0.000001235 * 3600),
    nat: nat * hours * 0.045,
    interfaceEndpoints: 4 * 2 * hours * 0.01,
    alb: hours * (0.0225 + 0.008),
    publicIpv4: (2 + nat) * hours * 0.005,
    databaseAllowance, operationsAllowance, waf,
  };
  console.log(stage, Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, Number(value.toFixed(2))])), "total", Object.values(rows).reduce((sum, value) => sum + value, 0).toFixed(2));
}
