-- How a merchant session was proven (audit C1). Switching stores and the store list follow
-- this proof, never the member row's own phone/email: an owner can put any phone on a row
-- they invite, so a row's phone is not evidence that whoever signed in owns it.
-- Sessions from before this column have no proof and stay in their own store.
alter table merchant_sessions
  add column if not exists proof_kind text check (proof_kind in ('phone', 'email')),
  add column if not exists proof_subject text check (char_length(proof_subject) <= 200);

alter table merchant_sessions drop constraint if exists merchant_sessions_proof_pair;
alter table merchant_sessions
  add constraint merchant_sessions_proof_pair
  check ((proof_kind is null) = (proof_subject is null));
