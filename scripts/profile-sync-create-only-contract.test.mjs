import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const r=readFileSync(new URL('../app/api/profile-sync/route.ts',import.meta.url),'utf8');
test('existing rows skip before changed/unchanged update branches',()=>{const skip=r.indexOf('if (body.createOnly && current) { result.skipped += 1; continue; }');assert.ok(skip>0);assert.ok(skip<r.indexOf('if (current?.source_content_hash === profile.contentHash)'));});
test('create-only refuses finalize and image reuse; storage never overwrites',()=>{assert.match(r,/body.createOnly && body.finalizeSnapshot/);assert.match(r,/createOnly && trackedRows\?\.length/);assert.match(r,/upsert: !createOnly/);assert.match(r,/createOnly\s*\? await supabase.from\("profile_source_images"\).insert/);});
test('create-only avoids city deletion and preflight maintenance RPC',()=>{assert.match(r,/body.createOnly \? \{error:null\} : await supabase.from\("profile_cities"\).delete/);assert.match(r,/recovery \? \{ error: null \} : await client.rpc/);});
test('base schema declares source identity uniqueness for insert conflict safety',()=>{const s=readFileSync(new URL('../supabase/new-project-init.sql',import.meta.url),'utf8');assert.match(s,/unique\(source_provider, source_key\)/);});
