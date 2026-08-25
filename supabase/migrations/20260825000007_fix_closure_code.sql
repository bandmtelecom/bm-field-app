-- ---------------------------------------------------------------------------
-- Fix next_closure_code — it had never once succeeded.
--
-- THE BUG
-- The function is declared `returns table (seq int, code text)`, which creates
-- PL/pgSQL variables named `seq` and `code`. Its body then referenced both
-- unqualified:
--
--     select code into v_prefix from customers where id = p_customer;
--     select coalesce(max(seq),0)+1 into v_seq from closures where ...;
--
-- Postgres cannot tell the OUT variable from the table column, so every call
-- raised 42702 "column reference is ambiguous". Not intermittently — always.
--
-- WHY IT WENT UNNOTICED FOR EIGHT DAYS
-- AddVisit.tsx and EditLocation.tsx both call this, then insert the closure,
-- and both discard the error:
--
--     const { data: closure } = await supabase.from('closures').insert({...})
--     closureId = closure?.id ?? null;
--
-- So the RPC failed, the insert failed, closureId became null, and the location
-- saved anyway with no closure attached and no message to the tech. The result
-- was 33 locations, 0 closures, and nothing that looked broken. The app-side
-- error handling is fixed separately; this file fixes the function itself.
--
-- THE FIX
-- Every column reference is table-qualified. Do not un-qualify them — the
-- ambiguity is silent at CREATE time and only shows up when the function runs.
--
-- Also raises a readable error when a customer has no short code, instead of
-- building a NULL code that fails later as a confusing not-null violation.
--
-- Safe to run on a live database: replaces a function, touches no data.
-- ---------------------------------------------------------------------------

create or replace function next_closure_code(p_customer uuid)
returns table (seq int, code text) language plpgsql as $$
declare v_seq int; v_code text; v_prefix text;
begin
  select c.code into v_prefix from customers c where c.id = p_customer;

  if v_prefix is null or v_prefix = '' then
    raise exception
      'Customer % has no short code set, so a closure code cannot be built. Set customers.code (e.g. ''Lumen'') first.',
      p_customer;
  end if;

  select coalesce(max(cl.seq), 0) + 1 into v_seq
    from closures cl
   where cl.customer_id = p_customer;

  v_code := v_prefix || '-' || lpad(v_seq::text, 4, '0');

  return query select v_seq, v_code;
end; $$;

-- NOTE ON CONCURRENCY
-- Allocation is max(seq)+1, and the app calls this in one request then inserts
-- in another, so two techs filing at the same instant can be handed the same
-- number. `closures.unique (customer_id, seq)` catches it and the second insert
-- fails. With the app no longer swallowing errors that surfaces as a visible,
-- retryable message rather than a silently dropped closure. Worth folding the
-- allocation and the insert into a single function if it ever bites in practice.
