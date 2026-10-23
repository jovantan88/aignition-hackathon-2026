import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { seedDemo } = await import("../src/db/seed");
  const t = Date.now();
  await seedDemo();
  console.log(`Seeded demo data in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
