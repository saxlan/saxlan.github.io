#!/bin/sh
# Push the Saxlan backend (src/) to its Apps Script project.
# Never let Google's permission screen appear for visitors: the web app runs as the owner for anyone, and the scopes stay
# exactly the two the owner grants once by running setup(). A new scope, a run-as-visitor setting or a Google service that
# needs another scope stops the push here.
set -e
cd "$(dirname "$0")"
if [ -n "$CLASP" ]; then :; elif command -v clasp >/dev/null 2>&1; then CLASP=clasp; else CLASP="npx --yes @google/clasp@3.4.1"; fi
# shared.js runs on both sides: the page loads it, and it is pushed as a server file
cp ../shared.js src/shared.js
node -e '
const fs=require("fs");
const m=JSON.parse(fs.readFileSync("src/appsscript.json","utf8"));
const want=["https://www.googleapis.com/auth/script.external_request","https://www.googleapis.com/auth/spreadsheets"];
const bad=[];
if(JSON.stringify((m.oauthScopes||[]).slice().sort())!==JSON.stringify(want.slice().sort()))bad.push("oauthScopes changed");
if(!m.webapp||m.webapp.executeAs!=="USER_DEPLOYING"||m.webapp.access!=="ANYONE_ANONYMOUS")bad.push("webapp must run as the owner for anyone");
if(m.dependencies&&Object.keys(m.dependencies).length)bad.push("advanced services need extra scopes");
if(m.executionApi||m.addOns||m.gmail||m.sheets)bad.push("unexpected manifest sections");
const files=fs.readdirSync("src").filter(f=>/\.(gs|js)$/.test(f));
const code=files.map(f=>fs.readFileSync("src/"+f,"utf8")).join("\n");
const banned=/\b(GmailApp|MailApp|DriveApp|DocumentApp|SlidesApp|FormApp|CalendarApp|ContactsApp|GroupsApp|ScriptApp|Session\.get(Active|Effective)User|Session\.getTemporaryActiveUserKey|AdminDirectory|YouTube|BigQuery|Drive\.|Gmail\.)\b/g;
const hits=[...new Set(code.match(banned)||[])];
if(hits.length)bad.push("uses "+hits.join(", "));
const extra=fs.readdirSync("src").filter(f=>!/^(Code\.gs|shared\.js|appsscript\.json|dict_[a-z]\.html|builtin\.html)$/.test(f));
if(extra.length)bad.push("unexpected files in src: "+extra.join(", "));
if(bad.length){console.error("REFUSING TO PUSH (would trigger the Google permission screen or ship something unexpected): "+bad.join("; "));process.exit(1);}'
# the shared Latin and Spanish resources (written by the planner's build_resources.py), base64 like the dictionary
base64 -i builtin.json | tr -d '\n' > src/builtin.html
# the typo-check dictionary, one file per first letter, base64 so HtmlService can't alter it (Code.gs hasWord_ reads them)
for l in a b c d e f g h i j k l m n o p q r s t u v w x y z; do
  grep "^$l" dict.txt | base64 | tr -d '\n' > "src/dict_$l.html"
done
$CLASP push --force
