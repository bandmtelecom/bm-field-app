-- Footage is information, not a number.
--
-- The crew types footage the way they write it on a sheet: "22,590'", "17,936'",
-- "about 15000", "see prints". As an integer column every one of those became
-- NULL on the way in, silently. It bills nothing -- no rate-card unit and no
-- engine path reads cables.footage -- so there is no reason for the database to
-- insist it be a number.
--
-- Existing integer values convert straight to their own digits ("15044") and
-- still display; the app appends " ft" to a bare number so old field reports
-- read exactly as they did before.
--
-- Austin, 8/28/26: "leave the area where the guys put that in as just blank and
-- let them put anything there. that area is just information it has nothing to
-- do with billing."
--
-- Verified against a real PostgreSQL 16: integer 15044 -> text '15044', and
-- '22,590' / 'see prints' insert cleanly afterwards.

alter table cables alter column footage type text using footage::text;
