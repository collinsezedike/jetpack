import { loadOwnerKeypair, addr } from "./actions.js";
import { runSwarm } from "./swarm.js";
import { NETWORK, PACKAGE_ID } from "./config.js";

async function main() {
  console.log("Jetpack — agent swarm demo");
  console.log("Package :", PACKAGE_ID);
  console.log("Network :", NETWORK);

  const owner = loadOwnerKeypair();
  console.log("Owner   :", addr(owner));

  await runSwarm(owner);
}

main().catch(console.error);
