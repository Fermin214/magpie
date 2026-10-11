const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

test("AgentHub migration preserves released fields and never changes its source", (t) => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"agenthub-export-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,"source.sqlite3"), output=path.join(dir,"favorites.json");
  const db=new DatabaseSync(source);
  db.exec("CREATE TABLE prompts(id TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,category TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',favorite INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,purpose TEXT NOT NULL DEFAULT ''); CREATE TABLE repository_bookmarks(id TEXT PRIMARY KEY NOT NULL,payload_json TEXT NOT NULL)");
  const date="2026-10-11T00:00:00Z";
  db.prepare("INSERT INTO prompts VALUES(?,?,?,?,?,?,?,?,?)").run("p1","写作","  保留原文。\n","工作",'["tag"]',1,date,date,"润色");
  const repository={id:"r1",name:"Example",url:"https://github.com/example/project",notes:"备注",tags:["read"],status:"in_use",archived:true,projectId:"old-project",createdAt:date,updatedAt:date};
  db.prepare("INSERT INTO repository_bookmarks VALUES(?,?)").run("r1",JSON.stringify(repository));
  db.close();
  const before=fs.readFileSync(source);
  const run=()=>execFileSync(process.execPath,[path.join(__dirname,"agenthub-export.mjs"),source,output],{stdio:"pipe"});
  run(); const result=JSON.parse(fs.readFileSync(output,"utf8"));
  assert.equal(result.schemaVersion,1);
  assert.deepEqual(result.prompts,[{id:"p1",title:"写作",body:"  保留原文。\n",category:"工作",tags:["tag"],favorite:true,createdAt:date,updatedAt:date,purpose:"润色"}]);
  assert.deepEqual(result.repositories,[repository]);
  assert.deepEqual(fs.readFileSync(source),before);
  const exported=fs.readFileSync(output); assert.throws(run); assert.deepEqual(fs.readFileSync(output),exported);
});
