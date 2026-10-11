// Explicit, read-only migration from AgentHub's released SQLite schema.
// node build/agenthub-export.mjs path/to/agenthub.sqlite3 output.json
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [source, output] = process.argv.slice(2);
if (!source || !output || process.argv.length !== 4) throw new Error('Usage: node build/agenthub-export.mjs source.sqlite3 output.json');
if (resolve(source) === resolve(output) || existsSync(output)) throw new Error('Choose a new output file.');
const db = new DatabaseSync(source, { readOnly: true });
try {
  db.exec("BEGIN"); // Both tables come from one consistent read snapshot.
  const prompts = db.prepare('SELECT id,title,body,purpose,category,tags_json,favorite,created_at,updated_at FROM prompts ORDER BY id').all().map((r) => ({
    id:r.id, title:r.title, body:r.body, purpose:r.purpose, category:r.category, tags:JSON.parse(r.tags_json), favorite:!!r.favorite, createdAt:r.created_at, updatedAt:r.updated_at,
  }));
  const repositories = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='repository_bookmarks'").get()
    ? db.prepare('SELECT payload_json FROM repository_bookmarks ORDER BY id').all().map((r) => {
      const v=JSON.parse(r.payload_json);
      return {id:v.id,name:v.name,url:v.url,notes:v.notes||'',tags:v.tags||[],status:v.status||'interested',archived:!!v.archived,projectId:v.projectId||'',createdAt:v.createdAt,updatedAt:v.updatedAt};
    }) : [];
  writeFileSync(output, JSON.stringify({schemaVersion:1,revision:0,prompts,repositories},null,2)+'\n', {flag:'wx', mode:0o600});
  console.log(JSON.stringify({prompts:prompts.length,repositories:repositories.length,output:resolve(output)}));
} finally { db.exec("ROLLBACK"); db.close(); }
