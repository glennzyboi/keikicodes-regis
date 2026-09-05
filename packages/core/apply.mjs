import postgres from "postgres";
import fs from "node:fs";
const sql = postgres("postgresql://postgres:postgres@127.0.0.1:55322/postgres",{max:1,prepare:false,onnotice:()=>{}});
const m = fs.readFileSync("../../supabase/migrations/20260906090000_sweep_on_a_schedule.sql","utf8");
try { await sql.unsafe(m); console.log("applied"); } catch(e){ console.log("error:", e.message); }
try { console.log(await sql`select jobname, schedule from cron.job`); } catch(e){ console.log("cron.job:", e.message); }
await sql.end();
