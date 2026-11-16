# Additive resume-v2 candidate: not deployed

No production migration, deployment, push, source/media access or legacy repair
was performed. The actual getTrustedResumeStore() always returns null. Even
with the route flag/header, it fails closed before DB/source access. SQL also
starts disabled with no immutable proof provider.

The adapter supplies the exact four-argument interface used by the candidate
route. Capability checks make zero RPC calls without a trusted server binding.
Begin only accepts replayed (boolean published receipt) or skipped-existing
(no publication claim); completion only accepts created/replayed with a boolean.
Store implementations cannot come from request JSON. No ordinary Supabase
Storage fallback, upsert, automatic write retry, delete or finalizer is used.

## Proposed database boundary

Admission atomically saves a NEW profile, initial city and original operation.
Unique provider/source identity is the retry key. Content, normalized draft
fields, city and ordered images must match the original. Fresh capture metadata
may advance without replacing the original CAS. Ordinary existing rows are
skipped; old incomplete drafts without a ledger cannot be adopted.

The new marker retains the create-only: prefix for old-client safety.
The candidate uses an explicit 180-second ownership lease and increasing
fencing epoch. This is a proposed new-lane policy, not a change to the existing
first image request or 120-second caller timeout.

Completion checks the whole original profile and a separate mutation revision,
including child changes, ABA, and presence fields excluded from updated_at.
Tracking remains active for open attempts even if capability is later disabled.
The narrowly scoped trigger uses fixed-search-path SECURITY DEFINER and has no
direct application-role EXECUTE. Other RPCs are invoker. Broad table/function
default grants, including service_role, are revoked before narrow grants.

No ledger reverse FKs block existing parent/city deletion. A changed/deleted
original causes CAS failure, never resurrection. Image/source insertion,
publication according to unchanged adult status, and the historical receipt
are one transaction. Pending remains draft. No cleanup/archive/delete is added.

Media digest/size/type are pinned before upload. Version and trusted immutable
object proofs are checked again before completion. SQL trusts the reviewed
service-side issuer; it cannot itself establish remote byte immutability.
Create-only upload, URL hash, 409 or ETag alone cannot satisfy this gate.

## Evidence and limits

- Adapter: 25/25 focused tests passed.
- Real PostgreSQL 17 single-user: 17 scenario groups passed, plus null-fence
  and narrow-role-grant regressions.
- Checks cover real transaction rollback, receipt replay, pending age,
  parent/child/presence/ABA conflicts, stale fences, digest/version mismatch,
  authenticated legacy writes, disabled-operation tracking, legacy refusal,
  and unchanged parent/city deletion semantics.
- Local fixture artifacts are under tests/resume-pg-local. Its data directory
  and logs are NOT migration or repository deliverables.

Unproven: multi-session locking/deadlock freedom, full production role/RLS
inheritance, real Supabase/Storage integration, real media decoding, and live
source eligibility. A fresh authenticated payload and DB presence CAS do not
constitute an independently implemented upstream attestation service.

A real immutable provider AND source-verification contract remain review gates.
This lane intentionally cannot run in the actual checkout. These tests do not
authorize enabling it, changing production schema, repairing legacy drafts,
or relaxing snapshot completeness.
