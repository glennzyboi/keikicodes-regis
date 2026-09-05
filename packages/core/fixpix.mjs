import postgres from "postgres";
async function clean(url, label) {
  const sql = postgres(url,{max:1,prepare:false,idle_timeout:2});
  for (const [table, col] of [["programs","image_url"],["schools","logo_url"]]) {
    const rows = await sql`select name, ${sql(col)} as url from ${sql(table)} where ${sql(col)} is not null`;
    for (const r of rows) {
      const res = await fetch(r.url).catch(() => null);
      if (!res || !res.ok) continue;
      const n = (await res.arrayBuffer()).byteLength;
      if (n < 200) {
        await sql`update ${sql(table)} set ${sql(col)} = null where name = ${r.name}`;
        console.log(`${label}: cleared ${table}.${col} for ${r.name} (${n} bytes)`);
      }
    }
  }
  await sql.end();
}
await clean(process.env.DATABASE_URL, "prod");
await clean("postgresql://postgres:postgres@127.0.0.1:55322/postgres", "local");
